/**
 * Small pure decisions used by the actions, kept free of `tools` so they can
 * be unit-tested without a Durable Object (see rules.test.ts).
 */

import {
  CREATE_LIMIT_PER_WINDOW,
  CREATE_LIMIT_WINDOW_MS,
  MAX_ACTIVE_ROOMS_GLOBAL,
  MAX_ACTIVE_ROOMS_PER_USER,
  MAX_PLAYERS,
} from '../../game'

/** A start claim younger than this might belong to a start still in progress. */
export const STALE_CLAIM_MS = 60_000 // Start now includes a model call of up to ~20 s

/**
 * Is an existing `storyDrafts` row a leftover from a start that died half way,
 * rather than a live (or finished) start?
 *
 * Stale = the game is still in the lobby, no blanks were ever created, AND the
 * claim is old enough that the winner of a concurrent double-start would
 * already have created its blanks. The age check stops a second click from
 * stealing the claim of a start that is merely slow.
 */
export function isStaleClaim(input: { phase: string; blankCount: number; claimAgeMs: number }): boolean {
  return input.phase === 'lobby' && input.blankCount === 0 && input.claimAgeMs >= STALE_CLAIM_MS
}

type Row = { id: string; createdAt: string }

/** Join order: createdAt, then id as a deterministic tie-breaker. */
export function byJoinOrder(a: Row, b: Row): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/**
 * The first MAX_PLAYERS memberships (in join order) are the players; anyone
 * beyond that is overflow and must be removed from the room.
 */
export function capRoster<T extends Row>(memberships: readonly T[]): { players: T[]; overflow: T[] } {
  const sorted = [...memberships].sort(byJoinOrder)
  return { players: sorted.slice(0, MAX_PLAYERS), overflow: sorted.slice(MAX_PLAYERS) }
}

/** Action params must be a plain JSON object (not null, not an array). */
export function isParamsObject(params: unknown): params is Record<string, unknown> {
  return typeof params === 'object' && params !== null && !Array.isArray(params)
}

/* ------------------------------------------------------------------ */
/* Room-creation limits                                                */
/* ------------------------------------------------------------------ */

export type CreateDecision =
  | { allowed: true }
  | { allowed: false; reason: 'rate' | 'user_cap' | 'global_busy'; message: string }

/**
 * Should this user be allowed to create another room right now? Pure: the
 * caller gathers the numbers from the `games` records.
 *
 * NOTE: the inputs are read and then a room is created, with no lock between,
 * so concurrent createGame calls can overshoot a limit by a request or two.
 * That is acceptable: the limits exist to stop floods, not to be exact, and an
 * exact counter would need a new serialized record or collection.
 */
export function decideCreate(input: {
  now: number
  /** createdAt (epoch ms) of rooms this user hosted recently; older ones may be included. */
  userCreatedAt: readonly number[]
  userActiveRooms: number
  globalActiveRooms: number
}): CreateDecision {
  const { now } = input
  // A room created exactly CREATE_LIMIT_WINDOW_MS ago is already outside the window.
  const inWindow = input.userCreatedAt.filter((t) => now - t < CREATE_LIMIT_WINDOW_MS)
  if (inWindow.length >= CREATE_LIMIT_PER_WINDOW) {
    // The slot frees when the oldest in-window room ages out of the window.
    const oldest = Math.min(...inWindow)
    const minutes = Math.max(1, Math.ceil((oldest + CREATE_LIMIT_WINDOW_MS - now) / 60_000))
    return {
      allowed: false,
      reason: 'rate',
      message: `You are creating rooms too quickly. Please wait about ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`,
    }
  }
  if (input.userActiveRooms >= MAX_ACTIVE_ROOMS_PER_USER) {
    return {
      allowed: false,
      reason: 'user_cap',
      message: `You already host ${MAX_ACTIVE_ROOMS_PER_USER} active rooms. Rooms expire after 2 hours, so try again later.`,
    }
  }
  if (input.globalActiveRooms >= MAX_ACTIVE_ROOMS_GLOBAL) {
    return {
      allowed: false,
      reason: 'global_busy',
      message: 'StorybookJam is very busy right now. Please try again in a little while.',
    }
  }
  return { allowed: true }
}
