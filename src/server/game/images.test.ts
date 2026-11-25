/**
 * Image job state machine and retryPage, against the fake with scripted fal
 * responses. Timing is injected so nothing waits in real time.
 */
import { describe, expect, it } from 'vitest'
import { ART_STYLE, GENERATION_CAP_CREDITS, IMAGE_MAX_COST_USD, MAX_PAGE_RETRIES } from '../../game'
import { retryPage, tick } from './actions'
import { createFakeTools } from './fakeTools'
import type { FakeTools, IntegrationCall } from './fakeTools'
import { runImageJob, STALE_GENERATING_MS, STALE_PENDING_MS, sweepStalePages } from './images'
import type { ImageTiming } from './images'
import { envFor, runAction, seedDraft, seedGame, seedPages } from './testSeed'

/** Fake clock: sleeping advances time, so deadlines are exercised instantly and deterministically. */
function fakeClock(): ImageTiming {
  let now = 0
  return { sleep: async (ms) => void (now += ms), now: () => now, pollMs: 1000, timeoutMs: 3000, callTimeoutMs: 1000 }
}
const run = (over: Partial<{ enabled: boolean; timing: ImageTiming; signal: AbortSignal }> = {}) => ({
  enabled: true,
  timing: fakeClock(),
  ...over,
})
const URL_OK = 'https://fal.media/files/abc.png'

/** fal that completes every job; `failFirst` makes the first N run-model calls error. */
function scriptFal(t: FakeTools, opts: { failFirst?: number; neverCompletes?: boolean } = {}) {
  let runs = 0
  t.onIntegration(({ endpoint }: IntegrationCall) => {
    if (endpoint === 'fal/run-model') {
      runs++
      return runs <= (opts.failFirst ?? 0)
        ? { success: false, error: 'fal 500' }
        : { success: true, data: { jobId: `job${runs}`, status: 'IN_QUEUE' } }
    }
    if (endpoint === 'fal/get-result') {
      return opts.neverCompletes
        ? { success: true, data: { status: 'IN_PROGRESS' } }
        : { success: true, data: { status: 'COMPLETED', output: { images: [{ url: URL_OK }] }, costUsd: 0.003 } }
    }
    return { success: false, error: 'unexpected' }
  })
}

async function game(t: FakeTools, statuses = ['pending', 'pending', 'pending', 'pending'], retries = 0) {
  const gameId = await seedGame(t, { phase: 'generating' })
  await seedDraft(t, gameId, { finalPrompts: ['p0', 'p1', 'p2', 'p3'] })
  await seedPages(t, gameId, statuses, retries)
  return gameId
}
const statuses = (t: FakeTools) => t.rows('pages').map((p) => p.data.imageStatus)
const falCalls = (t: FakeTools, e: string) => t.integrationCalls.filter((c) => c.endpoint === e)

describe('runImageJob', () => {
  it('draws every pending page, stores the url, and moves the game to ready', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t)
    scriptFal(t)
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['ready', 'ready', 'ready', 'ready'])
    expect(t.rows('pages').every((p) => p.data.imageUrl === URL_OK)).toBe(true)
    expect(t.rows('games')[0].data.phase).toBe('ready')
    expect(t.rows('spendLedger')).toHaveLength(4)
  })

  it('sends only the moderated prompt, the fixed style, and always the cost ceiling', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t)
    scriptFal(t)
    await runImageJob(t, gameId, run())
    for (const c of falCalls(t, 'fal/run-model')) {
      expect(c.body.model_id).toBe('fal-ai/flux/schnell')
      expect(c.body.maxCostUsd).toBe(IMAGE_MAX_COST_USD)
      const input = c.body.input as Record<string, unknown>
      expect(input.image_size).toEqual({ width: 768, height: 576 })
      expect(input.num_inference_steps).toBe(4)
      expect(String(input.prompt)).toContain(ART_STYLE)
      expect(String(input.prompt)).toMatch(/p[0-3]$/)
    }
  })

  it('retries a failed call once automatically, then succeeds', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending'])
    scriptFal(t, { failFirst: 1 })
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['ready'])
    expect(falCalls(t, 'fal/run-model')).toHaveLength(2)
    expect(t.rows('spendLedger')).toHaveLength(2) // each attempt is reserved
  })

  it('marks a page failed after the automatic retry also fails', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending'])
    scriptFal(t, { failFirst: 99 })
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['failed'])
    expect(falCalls(t, 'fal/run-model')).toHaveLength(2)
    expect(t.rows('games')[0].data.phase).toBe('ready') // settled, even though one failed
  })

  it('treats a poll timeout as a failed attempt', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending'])
    scriptFal(t, { neverCompletes: true })
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['failed'])
    expect(falCalls(t, 'fal/get-result').length).toBeGreaterThan(3)
  })

  it('rejects a non-https image url', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending'])
    t.onIntegration(({ endpoint }) =>
      endpoint === 'fal/run-model'
        ? { success: true, data: { jobId: 'j' } }
        : { success: true, data: { status: 'COMPLETED', output: { images: [{ url: 'javascript:alert(1)' }] } } },
    )
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['failed'])
  })

  it('marks pages skipped, with no fal call, once the cap is reached', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending', 'pending'])
    scriptFal(t)
    await t.create('spendLedger', { kind: 'llm-final', credits: GENERATION_CAP_CREDITS, gameId: 'old', ref: 'x' })
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['skipped', 'skipped'])
    expect(t.integrationCalls).toHaveLength(0)
  })

  it('is idempotent: a re-run touches only pending pages and never redoes finished ones', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['ready', 'pending', 'failed', 'skipped'])
    scriptFal(t)
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['ready', 'ready', 'failed', 'skipped'])
    expect(falCalls(t, 'fal/run-model')).toHaveLength(1)
    await runImageJob(t, gameId, run()) // again: nothing left to do
    expect(falCalls(t, 'fal/run-model')).toHaveLength(1)
  })

  it('a page left in "generating" by a dead run becomes FAILED (retryable), with no second fal call and no double spend', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['ready', 'generating'])
    // The dead run had already reserved page 1's first attempt (ledger key p1-r0-a1).
    await t.create('spendLedger', { kind: 'image', credits: 2, gameId, userId: 'host', ref: 'p1-r0-a1' })
    scriptFal(t)
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['ready', 'failed'])
    expect(t.integrationCalls).toHaveLength(0)
    expect(t.rows('spendLedger')).toHaveLength(1)
    expect(t.rows('games')[0].data.phase).toBe('ready') // settled, so the room is not stuck
  })

  it('a page that was never started (no ledger key) is simply drawn on a re-run', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['ready', 'generating']) // stale flag but nothing was reserved
    scriptFal(t)
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['ready', 'ready'])
  })

  it('kill switch inside the job: pending/generating pages are skipped, phase ready, fal never called', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending', 'generating', 'ready', 'failed'])
    scriptFal(t)
    await runImageJob(t, gameId, run({ enabled: false }))
    expect(statuses(t)).toEqual(['skipped', 'skipped', 'ready', 'failed'])
    expect(t.rows('games')[0].data.phase).toBe('ready')
    expect(t.integrationCalls).toHaveLength(0)
    expect(t.rows('spendLedger')).toHaveLength(0)
  })

  it('an unexpected error inside the job fails the in-flight pages and settles the phase (never throws)', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t)
    const real = t.query.bind(t)
    t.query = (async (c: string, o?: never) => {
      if (c === 'storyDrafts') throw new Error('boom')
      return real(c, o)
    }) as never
    await expect(runImageJob(t, gameId, run())).resolves.toBeUndefined()
    expect(statuses(t)).toEqual(['failed', 'failed', 'failed', 'failed'])
    expect(t.rows('games')[0].data.phase).toBe('ready')
  })

  it('a never-resolving fal call times out (per call and per page) and the page is failed', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending'])
    t.onIntegration(() => new Promise(() => {})) // hangs forever
    const real: ImageTiming = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      pollMs: 5,
      timeoutMs: 120,
      callTimeoutMs: 40,
    }
    const started = Date.now()
    await runImageJob(t, gameId, run({ timing: real }))
    expect(Date.now() - started).toBeLessThan(2000) // bounded: it did not hang the queue
    expect(statuses(t)).toEqual(['failed'])
    expect(t.rows('games')[0].data.phase).toBe('ready')
  })

  it('an aborted job signal stops the work and fails the page', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending'])
    t.onIntegration(() => new Promise(() => {}))
    const ac = new AbortController()
    const p = runImageJob(t, gameId, run({ signal: ac.signal }))
    setTimeout(() => ac.abort(), 10)
    await p
    expect(statuses(t)).toEqual(['failed'])
  })

  it('skips a page that has no moderated prompt instead of drawing from nothing', async () => {
    const t = createFakeTools('host')
    const gameId = await seedGame(t, { phase: 'generating' })
    await seedDraft(t, gameId, { finalPrompts: [] })
    await seedPages(t, gameId, ['pending'])
    scriptFal(t)
    await runImageJob(t, gameId, run())
    expect(statuses(t)).toEqual(['skipped'])
    expect(t.integrationCalls).toHaveLength(0)
  })
})

describe('sweepStalePages (self-heal)', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  it('fails generating pages stuck 5+ minutes and pending ones stuck 10+, then settles the phase', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['generating', 'pending', 'generating', 'ready'])
    const rows = t.rows('pages')
    rows[0].updatedAt = ago(STALE_GENERATING_MS + 1000) // stale
    rows[1].updatedAt = ago(STALE_PENDING_MS + 1000) // stale
    rows[2].updatedAt = ago(60_000) // fresh: a live run
    await sweepStalePages(t, gameId, Date.now())
    expect(statuses(t)).toEqual(['failed', 'failed', 'generating', 'ready'])
    expect(t.rows('games')[0].data.phase).toBe('generating') // one page still in flight
    rows[2].updatedAt = ago(STALE_GENERATING_MS + 1000)
    await sweepStalePages(t, gameId, Date.now())
    expect(statuses(t)).toEqual(['failed', 'failed', 'failed', 'ready'])
    expect(t.rows('games')[0].data.phase).toBe('ready')
  })

  it('does nothing to a healthy room', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['generating', 'pending'])
    await sweepStalePages(t, gameId, Date.now())
    expect(statuses(t)).toEqual(['generating', 'pending'])
  })

  it('tick triggers the sweep for a member (also covers a retry whose enqueue was lost)', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending']) // retryPage updated it, then the worker died before enqueue
    t.rows('pages')[0].updatedAt = ago(STALE_PENDING_MS + 1000)
    const r = await runAction(tick, 'p2', t, { gameId }, envFor(true))
    expect(r).toEqual({ success: true, data: { phase: 'ready' } })
    expect(statuses(t)).toEqual(['failed'])
  })

  it('a non-member cannot trigger it', async () => {
    const t = createFakeTools('host')
    const gameId = await game(t, ['pending'])
    t.rows('pages')[0].updatedAt = ago(STALE_PENDING_MS + 1000)
    expect(await runAction(tick, 'stranger', t, { gameId }, envFor(true))).toMatchObject({ success: false })
    expect(statuses(t)).toEqual(['pending'])
  })
})

describe('retryPage', () => {
  const env = envFor(true)
  const enqueued: string[] = []
  // retryPage enqueues through the real SDK helper; in unit tests the JOB_ROOMS
  // namespace is absent, so the enqueue fails and we can observe the rollback.
  async function setup(statuses: string[], retries = 0) {
    const t = createFakeTools('host')
    const gameId = await seedGame(t, { phase: 'ready' })
    await seedDraft(t, gameId, { finalPrompts: ['a', 'b', 'c', 'd'] })
    await seedPages(t, gameId, statuses, retries)
    return { t, gameId }
  }

  it('refuses a non-member (same answer as an unknown game)', async () => {
    const { t, gameId } = await setup(['failed'])
    const r = await runAction(retryPage, 'stranger', t, { gameId, idx: 0 }, env)
    expect(r).toEqual({ success: false, error: 'Game not found.' })
    expect(statuses(t)).toEqual(['failed'])
  })

  it('refuses a page that is not failed', async () => {
    const { t, gameId } = await setup(['ready', 'pending', 'skipped'])
    for (const idx of [0, 1, 2]) {
      const r = await runAction(retryPage, 'host', t, { gameId, idx }, env)
      expect(r.success).toBe(false)
    }
    expect(statuses(t)).toEqual(['ready', 'pending', 'skipped'])
  })

  it('refuses an unknown page, a bad idx, and bad params', async () => {
    const { t, gameId } = await setup(['failed'])
    expect((await runAction(retryPage, 'host', t, { gameId, idx: 9 }, env)).success).toBe(false)
    expect((await runAction(retryPage, 'host', t, { gameId, idx: '0' }, env)).success).toBe(false)
  })

  it(`refuses after ${MAX_PAGE_RETRIES} manual retries`, async () => {
    const { t, gameId } = await setup(['failed'], MAX_PAGE_RETRIES)
    const r = await runAction(retryPage, 'host', t, { gameId, idx: 0 }, env)
    expect(r).toMatchObject({ success: false })
    expect(t.rows('pages')[0].data.retries).toBe(MAX_PAGE_RETRIES)
  })

  it('refuses when generation is switched off', async () => {
    const { t, gameId } = await setup(['failed'])
    const r = await runAction(retryPage, 'host', t, { gameId, idx: 0 }, envFor(false))
    expect(r).toMatchObject({ success: false })
    expect(statuses(t)).toEqual(['failed'])
  })

  it('refuses on an expired room', async () => {
    const { t } = await setup(['failed'])
    const gameId = t.rows('games')[0].recordId
    await t.update('games', gameId, { expiresAt: 1 })
    const r = await runAction(retryPage, 'host', t, { gameId, idx: 0 }, env)
    expect(r).toEqual({ success: false, error: 'This room has expired.' })
  })

  it('refuses while other illustrations are still being drawn (an earlier job could swallow the retry)', async () => {
    const { t } = await setup(['failed', 'generating'])
    const gameId = t.rows('games')[0].recordId
    await t.update('games', gameId, { phase: 'generating' })
    const r = await runAction(retryPage, 'host', t, { gameId, idx: 0 }, env)
    expect(r).toMatchObject({ success: false })
    expect((r as { error: string }).error).toMatch(/still being drawn/i)
    // Nothing changed: the page is still failed and no retry was spent.
    expect(t.rows('pages')[0].data).toMatchObject({ imageStatus: 'failed', retries: 0 })
    expect(t.rows('games')[0].data.phase).toBe('generating')
  })

  it('for a member and a failed page: counts the retry, flips to pending/generating, queues the job', async () => {
    const { t, gameId } = await setup(['failed'])
    const queued: string[] = enqueued
    // Swap the namespace for one whose /enqueue fetch we can observe.
    const ns = { idFromName: (n: string) => n, get: () => ({ fetch: async (req: Request) => { queued.push(await req.text()); return Response.json({ job: { id: 'j1' } }) } }) }
    const r = await runAction(retryPage, 'p2', t, { gameId, idx: 0 }, { ...env, JOB_ROOMS: ns as never })
    expect(r.success).toBe(true)
    expect(t.rows('pages')[0].data).toMatchObject({ imageStatus: 'pending', retries: 1 })
    expect(t.rows('games')[0].data.phase).toBe('generating')
    expect(queued.join()).toContain('generate-images')
  })

  it('rolls back to failed if the job cannot be queued', async () => {
    const { t, gameId } = await setup(['failed'])
    const r = await runAction(retryPage, 'host', t, { gameId, idx: 0 }, env) // JOB_ROOMS is undefined here
    expect(r.success).toBe(false)
    expect(statuses(t)).toEqual(['failed'])
    expect(t.rows('games')[0].data.phase).toBe('ready')
  })
})
