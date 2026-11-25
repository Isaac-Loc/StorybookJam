/**
 * Physical deletion of expired rooms.
 *
 * Expiry itself is enforced by `isExpired` in every action, so cleanup only
 * reclaims storage; it can run late (or not at all) without exposing anything.
 * Deleting a room also deletes its finished story pages on purpose: stories
 * live only for the room's lifetime.
 *
 * Callers: the scheduled task in src/cron.ts, and createGame as a fallback in
 * case cron is not firing.
 */

import type { Tools, GameRecord } from './helpers'

/** Collections holding per-room child rows, all keyed by `gameId`. */
const CHILD_COLLECTIONS = ['memberships', 'blanks', 'storyDrafts', 'pages', 'narrations'] as const

/** Rows removed per deleteWhere call, and max calls per collection per room. */
const DELETE_PAGE = 100
const MAX_DRAIN_PASSES = 10

/**
 * Delete up to `maxRooms` expired rooms with all their child records.
 *
 * - Bounded: at most maxRooms rooms, each child collection at most
 *   MAX_DRAIN_PASSES * DELETE_PAGE rows per run (a room has < 20 child rows).
 * - Idempotent / concurrency-safe: deleting already-deleted rows is a no-op
 *   (`deleted: 0`), and the game row goes last, so a run that dies midway
 *   leaves the game in place and the next run finishes the job.
 * - `tools.query` only supports equality filters, so we ask for the rooms that
 *   expire SOONEST (ascending expiresAt) and filter `expiresAt <= now` here.
 */
export async function cleanupExpiredGames(
  tools: Tools,
  now: number,
  maxRooms: number,
): Promise<{ roomsDeleted: number }> {
  const page = await tools.query<GameRecord>('games', {
    orderBy: 'expiresAt',
    orderDir: 'asc',
    limit: maxRooms,
  })
  if (!page.success) return { roomsDeleted: 0 }

  let roomsDeleted = 0
  for (const game of page.data.records) {
    // Legacy rows without expiresAt read as 0 and are swept too (see isExpired).
    if ((game.data.expiresAt ?? 0) > now) break // sorted ascending: the rest are live
    if (!(await deleteChildren(tools, game.recordId))) continue // incomplete: retry next run
    const removed = await tools.remove('games', game.recordId)
    // A concurrent cleanup may have removed it first; either way it is gone.
    if (removed.success || /not found/i.test(removed.error)) roomsDeleted++
  }
  return { roomsDeleted }
}

/** Drains every child collection for one room. True when all are empty. */
async function deleteChildren(tools: Tools, gameId: string): Promise<boolean> {
  for (const collection of CHILD_COLLECTIONS) {
    let drained = false
    for (let pass = 0; pass < MAX_DRAIN_PASSES && !drained; pass++) {
      const r = await tools.deleteWhere(collection, { gameId }, DELETE_PAGE)
      if (!r.success) return false
      drained = r.data.deleted < DELETE_PAGE
    }
    if (!drained) return false
  }
  return true
}
