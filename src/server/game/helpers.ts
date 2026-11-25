/**
 * Shared plumbing for the game actions: record shapes, result helpers and a
 * few typed loaders.
 *
 * Reminder (see src/server/action-routes.ts): `tools.*` run with per-record
 * RBAC OFF. Nothing in here authorizes anybody; every action must check the
 * caller against the records it loads.
 */

import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { BlankSource, GamePhase, ImageStatus, NarrationStatus } from '../../game'
import type { StoryThemeId } from '../../story-themes'
import type { GameEnv } from './deps'
import { byJoinOrder, isParamsObject } from './rules'

/** Actions read only the few env bindings listed in GameEnv. */
export type GameAction = ActionHandler<GameEnv>

/**
 * Wraps an action so a malformed body (null, an array, a string...) or an
 * unexpected throw becomes a clean `{ success: false, error }` instead of a
 * crashed request. Details are logged, never returned.
 */
export function guarded(handler: GameAction): GameAction {
  return async (ctx) => {
    if (!isParamsObject(ctx.params)) return { success: false, error: 'Invalid request.' }
    try {
      return await handler(ctx)
    } catch (e) {
      console.error('[game] action failed:', e instanceof Error ? e.message : 'unknown error')
      return { success: false, error: 'Something went wrong. Please try again.' }
    }
  }
}

export type Tools = ActionTools

/* Record shapes. `type` aliases (not interfaces) so they satisfy the
 * `Record<string, unknown>` constraint on the tools.* generics. */

export type GameRecord = {
  code: string
  hostId: string
  phase: GamePhase
  lobbyTheme?: StoryThemeId
  storyTheme?: StoryThemeId
  playerIds: string[]
  playerNames: Record<string, string>
  phaseEndsAt: number
  expiresAt: number
  filledCount: number
  finishedPlayerIds?: string[]
  totalBlanks: number
  title: string
}

export type MembershipRecord = { gameId: string; userId: string; name: string }

export type BlankRecord = {
  gameId: string
  idx: number
  label: string
  value: string
  filled: number
  source: BlankSource
  assignedTo: string
}

/** Server-only story data for one game (no client role can read it). */
export type DraftRecord = {
  gameId: string
  title: string
  pages: string[]
  labels: string[]
  safety: string[][]
  imagePrompts: string[]
  finalPrompts: string[]
  source: 'model' | 'fixed'
}

export type PageRecord = {
  gameId: string
  idx: number
  text: string
  imageUrl: string
  imageStatus: ImageStatus
  narrationStatus?: NarrationStatus
  retries: number
  playerIds: string[]
}

export type NarrationRecord = { gameId: string; idx: number; audioUrl: string }

/** A loaded record together with its id. */
export type Loaded<T> = { id: string; data: T; createdAt: string; updatedAt?: string }

/* Result helpers */

export function ok<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

export function fail(error: string): ActionResult<never> {
  return { success: false, error }
}

/** The DO reports a uniqueOn violation as a refusal whose text starts with "Duplicate". */
export function isDuplicate(result: ActionResult<unknown>): boolean {
  return !result.success && /duplicate/i.test(result.error)
}

/** Safety margin above any real page size (6 blanks, 6 players, 4 pages). */
const QUERY_LIMIT = 50

/* Typed loaders. Each returns null when the record is missing (or the lookup failed). */

export async function loadGame(tools: Tools, gameId: string): Promise<Loaded<GameRecord> | null> {
  if (typeof gameId !== 'string' || !gameId) return null
  const r = await tools.get<GameRecord>('games', gameId)
  return r.success ? { id: r.data.record.recordId, data: r.data.record.data, createdAt: r.data.record.createdAt } : null
}

export async function loadBlank(tools: Tools, blankId: string): Promise<Loaded<BlankRecord> | null> {
  if (typeof blankId !== 'string' || !blankId) return null
  const r = await tools.get<BlankRecord>('blanks', blankId)
  return r.success ? { id: r.data.record.recordId, data: r.data.record.data, createdAt: r.data.record.createdAt } : null
}

export async function listBlanks(tools: Tools, gameId: string): Promise<Loaded<BlankRecord>[]> {
  const r = await tools.query<BlankRecord>('blanks', { where: { gameId }, limit: QUERY_LIMIT })
  if (!r.success) return []
  return r.data.records
    .map((x) => ({ id: x.recordId, data: x.data, createdAt: x.createdAt, updatedAt: x.updatedAt }))
    .sort((a, b) => a.data.idx - b.data.idx)
}

export async function listMemberships(
  tools: Tools,
  gameId: string,
): Promise<Loaded<MembershipRecord>[]> {
  const r = await tools.query<MembershipRecord>('memberships', { where: { gameId }, limit: QUERY_LIMIT })
  if (!r.success) return []
  // Oldest first, recordId as a tie-breaker, so every caller sees the same order.
  return r.data.records
    .map((x) => ({ id: x.recordId, data: x.data, createdAt: x.createdAt }))
    .sort(byJoinOrder)
}

/** The caller's own membership in a game, or null. Used as the "am I in this room" check. */
export async function findMembership(
  tools: Tools,
  gameId: string,
  userId: string,
): Promise<Loaded<MembershipRecord> | null> {
  const r = await tools.query<MembershipRecord>('memberships', {
    where: { gameId, userId },
    limit: 1,
  })
  if (!r.success || r.data.records.length === 0) return null
  const x = r.data.records[0]
  return { id: x.recordId, data: x.data, createdAt: x.createdAt }
}

/** The story draft record for a game, or null. */
export async function loadDraft(tools: Tools, gameId: string): Promise<Loaded<DraftRecord> | null> {
  const r = await tools.query<DraftRecord>('storyDrafts', { where: { gameId }, limit: 1 })
  if (!r.success || r.data.records.length === 0) return null
  const x = r.data.records[0]
  return { id: x.recordId, data: x.data, createdAt: x.createdAt }
}

export async function listPages(tools: Tools, gameId: string): Promise<Loaded<PageRecord>[]> {
  const r = await tools.query<PageRecord>('pages', { where: { gameId }, limit: 50 })
  if (!r.success) return []
  return r.data.records
    .map((x) => ({ id: x.recordId, data: x.data, createdAt: x.createdAt, updatedAt: x.updatedAt }))
    .sort((a, b) => a.data.idx - b.data.idx)
}
