/**
 * Fill-phase bookkeeping: expiring the timer, counting filled blanks
 * (`settle`) and assembling the finished story (`reveal`).
 *
 * All of these can run concurrently (every player's browser calls `tick`, and
 * several players may submit at the same moment), so each one is written to be
 * idempotent and to converge on the right answer.
 */

import { fillTemplate, pickFrom, pickSafety } from '../../game'
import type { ImageStatus } from '../../game'
import { reserveSpend } from './budget'
import type { GenDeps } from './deps'
import { polishStory } from './generate'
import type { BlankRecord, DraftRecord, GameRecord, PageRecord, Tools } from './helpers'
import { isDuplicate, listBlanks, listPages, loadDraft, loadGame } from './helpers'

/** A reveal claim older than this with no pages means the claimant died. */
const REVEAL_STALE_MS = 60_000

/** Per-game safety word for a blank: from the drafted story, else the built-in list. */
export async function safetyWordFor(tools: Tools, gameId: string, idx: number): Promise<string> {
  const draft = await loadDraft(tools, gameId)
  const list = draft?.data.safety?.[idx]
  return list && list.length > 0 ? pickFrom(list) : pickSafety(idx)
}

/**
 * Timer ran out: fill every still-empty blank with a safety word
 * (source 'timeout'), then settle (which reveals).
 *
 * Idempotent: it only touches blanks that are unfilled at the moment it
 * reads them, so a second concurrent call finds nothing (or at worst
 * re-fills a blank with another equally valid safety word before the story
 * is assembled).
 */
export async function expireGame(tools: Tools, gameId: string, deps: GenDeps): Promise<void> {
  const blanks = await listBlanks(tools, gameId)
  const draft = await loadDraft(tools, gameId)
  await Promise.all(
    blanks
      .filter((b) => b.data.filled !== 1)
      .map((b) => {
        const list = draft?.data.safety?.[b.data.idx]
        return tools.update<BlankRecord>('blanks', b.id, {
          value: list && list.length > 0 ? pickFrom(list) : pickSafety(b.data.idx),
          filled: 1,
          source: 'timeout',
        })
      }),
  )
  await settle(tools, gameId, deps)
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
export async function settle(tools: Tools, gameId: string, deps: GenDeps): Promise<void> {
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

  if (total > 0 && filled === total) await reveal(tools, gameId, deps)
}

/**
 * Stage 1 of the reveal: assemble the story, moderate it with ONE model call,
 * publish the pages, and queue the image job.
 *
 * Player words are untrusted, so they never reach the image model directly:
 * only the moderated output of the polish call is used for image prompts. If
 * the polish call is switched off, over budget, or fails, the plain substituted
 * text is shown (words are already length/character limited) and every page is
 * marked 'skipped': no illustration is ever made from unmoderated text.
 *
 * Concurrency: the 'llm-final' ledger row is unique per game, so exactly ONE
 * concurrent reveal gets to make the paid call; the others see `duplicate` and
 * leave (unless that claim is stale, see claimIsStale). Pages are unique per
 * (game, idx), so a repeated reveal cannot duplicate them either.
 */
export async function reveal(tools: Tools, gameId: string, deps: GenDeps): Promise<void> {
  const game = await loadGame(tools, gameId)
  if (!game || game.data.phase !== 'filling') return // already revealed (or not started)
  const draft = await loadDraft(tools, gameId)
  if (!draft) return

  const blanks = await listBlanks(tools, gameId)
  // Defensive: never reveal a story with holes in it.
  if (blanks.length === 0 || blanks.some((b) => b.data.filled !== 1)) return
  const values: string[] = []
  for (const b of blanks) values[b.data.idx] = b.data.value

  let polished: { text: string; imagePrompt: string }[] | null = null
  if (deps.enabled) {
    const claim = await reserveSpend(tools, 'llm-final', gameId, 'final', game.data.hostId)
    if (claim === 'ok') {
      polished = await polishStory(tools, draft.data, values)
    } else if (claim === 'duplicate' && !(await claimIsStale(tools, gameId))) {
      return // another reveal is mid-flight; it will publish the pages
    }
    // 'over_budget', or a stale claim (its owner died): continue with the
    // no-illustration fallback. Pages the dead run already wrote are kept as
    // they are; only the missing ones are added (creation is idempotent).
  }

  const plain = draft.data.pages.map((t) => fillTemplate(t, values))
  const pageTexts = polished ? polished.map((p) => p.text) : plain
  const status: ImageStatus = polished ? 'pending' : 'skipped'

  for (let idx = 0; idx < pageTexts.length; idx++) {
    const created = await tools.create<PageRecord>('pages', {
      gameId,
      idx,
      text: pageTexts[idx],
      imageUrl: '',
      imageStatus: status,
      retries: 0,
      playerIds: game.data.playerIds,
    })
    if (!created.success && !isDuplicate(created)) return // real failure: a later tick retries
  }

  if (polished) {
    await tools.update<DraftRecord>('storyDrafts', draft.id, { finalPrompts: polished.map((p) => p.imagePrompt) })
  }
  // Decide from the pages that actually exist (a takeover may inherit pending
  // ones): text is readable right away, 'ready' straight away if nothing is left to draw.
  const anyPending = (await listPages(tools, gameId)).some((p) => p.data.imageStatus === 'pending')
  await tools.update<GameRecord>('games', gameId, {
    phase: anyPending ? 'generating' : 'ready',
    title: draft.data.title,
  })

  if (anyPending) {
    try {
      await deps.enqueueImages(gameId)
    } catch {
      // Could not queue: let players retry each page instead of waiting forever.
      for (const p of await listPages(tools, gameId)) {
        if (p.data.imageStatus === 'pending') {
          await tools.update<PageRecord>('pages', p.id, { imageStatus: 'failed' })
        }
      }
      await tools.update<GameRecord>('games', gameId, { phase: 'ready' })
    }
  }
}

/**
 * The claimant died if its ledger row is old and the game is still 'filling'
 * (reveal() already returned early otherwise). Pages may or may not exist: a
 * half-written set is completed by the takeover, so it must not block it.
 */
async function claimIsStale(tools: Tools, gameId: string): Promise<boolean> {
  const row = await tools.query('spendLedger', { where: { gameId, kind: 'llm-final' }, limit: 1 })
  if (!row.success) return false
  const created = row.data.records[0]?.createdAt
  return !!created && Date.now() - Date.parse(created) >= REVEAL_STALE_MS
}
