/**
 * Stage 2 of the reveal: page illustrations, run by the `generate-images`
 * background job (src/jobs.ts) and by `retryPage`.
 *
 * Per-page state machine (imageStatus):
 *
 *   pending --claim--> generating --ok--> ready
 *                          |  \--fail twice / deadline--> failed --retryPage--> pending
 *                          \--over budget / switch off--> skipped
 *
 * Safety nets, because the job queue is ONE job at a time for the whole app,
 * so a stuck run would block every game:
 *  - every fal call has its own timeout and every page a wall-clock deadline
 *    (so a hung request cannot hold the queue);
 *  - any error inside the job marks the pages still in flight 'failed';
 *  - `sweepStalePages` (called from `tick`) fails pages that sat in
 *    pending/generating far too long (a crashed run or lost enqueue), so the
 *    room can never stay in 'generating' forever;
 *  - the kill switch is re-checked here: with generation off, pages are
 *    'skipped' and fal is never called.
 *
 * Re-running is safe (the platform may retry a job once). Each fal attempt has
 * its own ledger key (page, manual-retry count, attempt). If a dead run already
 * reserved an attempt, the re-run sees a Duplicate for it, does NOT call fal
 * again (no double spend) and marks the page 'failed', so the player can retry
 * it with a fresh key. Pages never started carry no key and are simply drawn.
 *
 * Only the MODERATED prompt stored in `storyDrafts.finalPrompts` is sent to
 * fal, never a player's raw word.
 */

import {
  IMAGE_MAX_COST_USD,
  IMAGE_MODEL_ID,
  IMAGE_POLL_MS,
  IMAGE_SIZE,
  IMAGE_TIMEOUT_MS,
  pageMediaInFlight,
} from '../../game'
import { getStoryTheme } from '../../story-themes'
import { reserveSpend } from './budget'
import type { GameRecord, Loaded, PageRecord, Tools } from './helpers'
import { listPages, loadDraft, loadGame } from './helpers'

/** Timing knobs, injectable so unit tests do not wait in real time. */
export type ImageTiming = {
  sleep: (ms: number) => Promise<void>
  now: () => number
  pollMs: number
  /** Wall-clock budget for ONE render attempt, call latency included. */
  timeoutMs: number
  /** Cap for a single fal request, so one hung call cannot eat the whole attempt. */
  callTimeoutMs: number
}

export const realTiming: ImageTiming = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  pollMs: IMAGE_POLL_MS,
  timeoutMs: IMAGE_TIMEOUT_MS,
  callTimeoutMs: 15_000,
}

/** A page stuck this long is considered dead by sweepStalePages. */
export const STALE_GENERATING_MS = 5 * 60_000
/** Pending may legitimately wait behind other games' jobs, so allow longer. */
export const STALE_PENDING_MS = 10 * 60_000

/** Attempts per image call (the first plus one automatic retry). */
const ATTEMPTS = 2

type RunResponse = { jobId?: string; status?: string }
type ResultResponse = { status?: string; output?: { images?: { url?: string }[] }; error?: unknown }

/** Only https URLs are ever stored (they end up in an <img src>). */
function safeUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    return new URL(u).protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

/** Resolves to null (never rejects) on timeout, abort, or a thrown error. */
function guarded<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    const done = (v: T | null) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(v)
    }
    const timer = setTimeout(() => done(null), Math.max(0, ms))
    const onAbort = () => done(null)
    signal?.addEventListener('abort', onAbort)
    if (signal?.aborted) return done(null)
    work.then(done, () => done(null))
  })
}

/** One fal render: start, then poll until COMPLETED, an error, or the deadline. Null = failed. */
async function renderImage(tools: Tools, prompt: string, timing: ImageTiming, signal?: AbortSignal): Promise<string | null> {
  const deadline = timing.now() + timing.timeoutMs
  const left = () => deadline - timing.now()
  const callMs = () => Math.min(timing.callTimeoutMs, left())

  const started = await guarded(
    tools.integration<RunResponse>('fal/run-model', {
      model_id: IMAGE_MODEL_ID,
      input: { prompt, image_size: IMAGE_SIZE, num_inference_steps: 4 },
      maxCostUsd: IMAGE_MAX_COST_USD, // never the $2 default reservation
    }),
    callMs(),
    signal,
  )
  if (!started || !started.success || !started.data.jobId) return null

  while (left() > 0 && !signal?.aborted) {
    const r = await guarded(
      tools.integration<ResultResponse>('fal/get-result', { request_id: started.data.jobId }),
      callMs(),
      signal,
    )
    if (!r || !r.success) return null
    if (r.data.status === 'COMPLETED') return safeUrl(r.data.output?.images?.[0]?.url)
    if (r.data.error) return null
    await timing.sleep(timing.pollMs)
  }
  return null // deadline or abort
}

/** Drives one page to a final state and writes it. */
async function runPage(
  tools: Tools,
  gameId: string,
  hostId: string,
  page: Loaded<PageRecord>,
  prompt: string | undefined,
  timing: ImageTiming,
  signal?: AbortSignal,
): Promise<void> {
  const set = (patch: Partial<PageRecord>) => tools.update<PageRecord>('pages', page.id, patch)
  if (!prompt) return void (await set({ imageStatus: 'skipped' })) // nothing moderated to draw from

  await set({ imageStatus: 'generating' })
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    // Each attempt is its own ledger row, keyed by manual-retry count + attempt.
    const ref = `p${page.data.idx}-r${page.data.retries}-a${attempt}`
    const reservation = await reserveSpend(tools, 'image', gameId, ref, hostId)
    if (reservation === 'over_budget') return void (await set({ imageStatus: 'skipped' }))
    if (reservation === 'duplicate') break // a dead run already paid for this attempt: let the player retry
    const url = await renderImage(tools, prompt, timing, signal)
    if (url) return void (await set({ imageStatus: 'ready', imageUrl: url }))
    if (signal?.aborted) break
  }
  await set({ imageStatus: 'failed' })
}

const inFlight = (p: Loaded<PageRecord>) => p.data.imageStatus === 'pending' || p.data.imageStatus === 'generating'

/** Sets every pending/generating page of a game to `status`. */
async function settleInFlight(tools: Tools, gameId: string, status: 'failed' | 'skipped'): Promise<void> {
  for (const p of (await listPages(tools, gameId)).filter(inFlight)) {
    await tools.update<PageRecord>('pages', p.id, { imageStatus: status })
  }
}

export type ImageJobOptions = {
  /** The generation kill switch, read from the env by the caller. */
  enabled: boolean
  timing?: ImageTiming
  /** The job's cancel/abort signal. */
  signal?: AbortSignal
}

/** The whole job for one game. Safe to run again at any time; never throws. */
export async function runImageJob(tools: Tools, gameId: string, opts: ImageJobOptions): Promise<void> {
  const timing = opts.timing ?? realTiming
  const game = await loadGame(tools, gameId)
  if (!game) return

  if (!opts.enabled) {
    // Kill switch: no fal call, ever. Treat like the over-budget fallback.
    await settleInFlight(tools, gameId, 'skipped')
    await finishIfSettled(tools, gameId)
    return
  }

  try {
    const draft = await loadDraft(tools, gameId)
    const { artStyle } = getStoryTheme(game.data.storyTheme)
    const todo = (await listPages(tools, gameId)).filter(inFlight)
    // All pages in parallel; each updates its own row as soon as it settles, so
    // the UI fills in live. allSettled: one page blowing up must not abandon the others.
    await Promise.allSettled(
      todo.map((page) => {
        const scene = draft?.data.finalPrompts?.[page.data.idx]
        const prompt = scene ? `${artStyle} ${scene}` : undefined
        return runPage(tools, gameId, game.data.hostId, page, prompt, timing, opts.signal)
      }),
    )
  } catch {
    /* fall through: whatever is still in flight is failed below */
  }
  // Anything still pending/generating now was left behind by an error.
  await settleInFlight(tools, gameId, 'failed')
  await finishIfSettled(tools, gameId)
}

/** Phase 'ready' once all illustration and narration work has settled. */
export async function finishIfSettled(tools: Tools, gameId: string): Promise<void> {
  const pages = await listPages(tools, gameId)
  if (pages.length > 0 && !pages.some(({ data }) => pageMediaInFlight(data))) {
    const game = await loadGame(tools, gameId)
    if (game && game.data.phase === 'generating') {
      await tools.update<GameRecord>('games', gameId, { phase: 'ready' })
    }
  }
}

/**
 * Fails pages that have been in flight implausibly long (a crashed job, or a
 * retry whose enqueue was lost) and settles the phase, so the room cannot sit
 * in 'generating' forever. Idempotent; called from `tick`.
 */
export async function sweepStalePages(tools: Tools, gameId: string, now: number): Promise<void> {
  for (const p of await listPages(tools, gameId)) {
    const age = now - Date.parse(p.updatedAt ?? p.createdAt)
    const limit = p.data.imageStatus === 'generating' ? STALE_GENERATING_MS : STALE_PENDING_MS
    const patch: Partial<PageRecord> = {}
    if (inFlight(p) && age >= limit) patch.imageStatus = 'failed'
    if (p.data.narrationStatus === 'pending' && age >= STALE_PENDING_MS) patch.narrationStatus = 'failed'
    if (Object.keys(patch).length > 0) await tools.update<PageRecord>('pages', p.id, patch)
  }
  await finishIfSettled(tools, gameId)
}
