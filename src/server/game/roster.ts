/**
 * Room roster handling.
 *
 * The AUTHORITATIVE roster is the `memberships` collection (uniqueOn gameId +
 * userId, one row per player, written by a single create each). The
 * `playerIds`/`playerNames` fields on the game are a denormalized copy: they
 * exist so every player can read the player list through the `shared` read
 * rule on `games`, which memberships ('own') cannot provide.
 *
 * Because the copy is a read-modify-write of a whole array, two players
 * joining at once could overwrite each other. syncRoster below prevents lost
 * updates by always REBUILDING the copy from memberships and verifying it.
 */

import { MAX_PLAYERS } from '../../game'
import type { GameRecord, Loaded, MembershipRecord, Tools } from './helpers'
import { listMemberships, loadGame } from './helpers'

/** Looks a room up by its (already normalized) code. */
export async function findGameByCode(tools: Tools, code: string): Promise<Loaded<GameRecord> | null> {
  const r = await tools.query<GameRecord>('games', { where: { code }, limit: 1 })
  if (!r.success || r.data.records.length === 0) return null
  const x = r.data.records[0]
  return { id: x.recordId, data: x.data, createdAt: x.createdAt }
}

/** Host first, then join order. */
function orderedRoster(memberships: Loaded<MembershipRecord>[], hostId: string) {
  return [...memberships].sort((a, b) => Number(b.data.userId === hostId) - Number(a.data.userId === hostId))
}

function rosterOf(memberships: Loaded<MembershipRecord>[], hostId: string) {
  const ordered = orderedRoster(memberships, hostId)
  const playerIds = ordered.map((m) => m.data.userId)
  const playerNames: Record<string, string> = {}
  for (const m of ordered) playerNames[m.data.userId] = m.data.name
  return { playerIds, playerNames }
}

function sameRoster(game: GameRecord, playerIds: string[], playerNames: Record<string, string>) {
  return (
    game.playerIds.length === playerIds.length &&
    game.playerIds.every((id, i) => id === playerIds[i] && game.playerNames[id] === playerNames[id])
  )
}

/**
 * Rebuild the game's playerIds/playerNames from the memberships and verify.
 *
 * Why the verify loop: two joins running concurrently can interleave as
 *   X reads roster -> Y creates + reads + writes -> X writes (stale, drops Y).
 * After each write we re-read BOTH the game and the memberships; if the game
 * copy no longer matches the memberships (someone joined, or our write was
 * clobbered), we rebuild again. The member who joined last always performs the
 * final correct write, so the roster converges. Gives up after 3 passes and
 * reports false; the next join/start/leave re-syncs anyway.
 */
export async function syncRoster(tools: Tools, gameId: string): Promise<boolean> {
  for (let pass = 0; pass < 3; pass++) {
    const game = await loadGame(tools, gameId)
    if (!game) return false
    const { playerIds, playerNames } = rosterOf(await listMemberships(tools, gameId), game.data.hostId)

    if (!sameRoster(game.data, playerIds, playerNames)) {
      const u = await tools.update<GameRecord>('games', gameId, { playerIds, playerNames })
      if (!u.success) return false
    }

    // Read-back: is what is stored now what the memberships say now?
    const after = await loadGame(tools, gameId)
    const latest = rosterOf(await listMemberships(tools, gameId), game.data.hostId)
    if (after && sameRoster(after.data, latest.playerIds, latest.playerNames)) return true
  }
  return false
}

/**
 * Position of a membership in join order (0-based). Joiners use it to decide
 * deterministically who loses when more than MAX_PLAYERS raced for the last
 * seat: exactly the rows ranked MAX_PLAYERS or later back out, so the room
 * never ends up over capacity AND two racers never both back out of one seat.
 */
export function joinRank(memberships: Loaded<MembershipRecord>[], membershipId: string): number {
  return memberships.findIndex((m) => m.id === membershipId)
}

export const isOverCapacity = (rank: number) => rank < 0 || rank >= MAX_PLAYERS
