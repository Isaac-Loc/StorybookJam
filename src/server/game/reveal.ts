/**
 * Fill-phase bookkeeping: expiring the timer, counting filled blanks
 * (`settle`) and assembling the finished story (`reveal`).
 *
 * All of these can run concurrently (every player's browser calls `tick`, and
 * several players may submit at the same moment), so each one is written to be
 * idempotent and to converge on the right answer.
 */

import { fillTemplate, pickSafety } from '../../game'
import type { BlankRecord, DraftRecord, GameRecord, PageRecord, Tools } from './helpers'
import { isDuplicate, listBlanks, loadGame } from './helpers'

/**
 * Timer ran out: fill every still-empty blank with a safety word
 * (source 'timeout'), then settle (which reveals).
 *
 * Idempotent: it only touches blanks that are unfilled at the moment it
 * reads them, so a second concurrent call finds nothing (or at worst
 * re-fills a blank with another equally valid safety word before the story
 * is assembled).
 */
export async function expireGame(tools: Tools, gameId: string): Promise<void> {
  const blanks = await listBlanks(tools, gameId)
  await Promise.all(
    blanks
      .filter((b) => b.data.filled !== 1)
      .map((b) =>
        tools.update<BlankRecord>('blanks', b.id, {
          value: pickSafety(b.data.idx),
          filled: 1,
          source: 'timeout',
        }),
      ),
  )
  await settle(tools, gameId)
}

/**
 * Recount filled blanks, publish the count on the game, and reveal when
 * everything is filled.
 *
 * The count is a read-modify-write across independent requests, so two
 * submissions can race: A counts 5, B counts 6 and writes 6, then A writes its
 * stale 5. We therefore re-count after writing and loop (max 3 passes) until
 * the stored value equals a fresh count. The last submitter's pass always sees
 * the full count, so the stored number converges to the truth.
 */
export async function settle(tools: Tools, gameId: string): Promise<void> {
  let filled = 0
  let total = 0
  for (let pass = 0; pass < 3; pass++) {
    const game = await loadGame(tools, gameId)
    if (!game) return
    total = game.data.totalBlanks
    filled = (await listBlanks(tools, gameId)).filter((b) => b.data.filled === 1).length

    if (game.data.filledCount !== filled) {
      await tools.update<GameRecord>('games', gameId, { filledCount: filled })
    }

    // Stable when a fresh read of both sides agrees with the count we used.
    const check = await loadGame(tools, gameId)
    const recount = (await listBlanks(tools, gameId)).filter((b) => b.data.filled === 1).length
    if (check && check.data.filledCount === recount) {
      filled = recount
      break
    }
  }

  if (total > 0 && filled === total) await reveal(tools, gameId)
}

/**
 * Assemble the story from the draft template plus the blank values, publish
 * the pages, then flip the game to `revealed`.
 *
 * Concurrent reveals are safe: pages are unique on (gameId, idx), so the
 * second creator gets a Duplicate refusal, which we ignore; the final game
 * update writes the same values either way.
 */
export async function reveal(tools: Tools, gameId: string): Promise<void> {
  const game = await loadGame(tools, gameId)
  if (!game || game.data.phase === 'revealed') return

  const draftRes = await tools.query<DraftRecord>('storyDrafts', { where: { gameId }, limit: 1 })
  if (!draftRes.success || draftRes.data.records.length === 0) return
  const draft = draftRes.data.records[0].data

  const blanks = await listBlanks(tools, gameId)
  // Defensive: never reveal a story with holes in it.
  if (blanks.length === 0 || blanks.some((b) => b.data.filled !== 1)) return
  const values: string[] = []
  for (const b of blanks) values[b.data.idx] = b.data.value

  for (let idx = 0; idx < draft.pages.length; idx++) {
    const created = await tools.create<PageRecord>('pages', {
      gameId,
      idx,
      text: fillTemplate(draft.pages[idx], values),
      imageUrl: '',
      imageStatus: 'none',
      playerIds: game.data.playerIds,
    })
    if (!created.success && !isDuplicate(created)) return // real failure: leave phase alone so a later tick retries
  }

  await tools.update<GameRecord>('games', gameId, { phase: 'revealed', title: draft.title })
}
