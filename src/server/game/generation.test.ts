/**
 * Story drafting at Start and the two-stage reveal, against the in-memory
 * fake with scripted anthropic responses. No real calls, no spend.
 */
import { describe, expect, it } from 'vitest'
import { COST_ESTIMATE_CREDITS, GENERATION_CAP_CREDITS, PAGE_COUNT } from '../../game'
import { setStoryTheme, startGame } from './actions'
import { generationEnabled } from './deps'
import { askClaude } from './llm'
import type { GenDeps } from './deps'
import { createFakeTools } from './fakeTools'
import type { FakeTools } from './fakeTools'
import { reveal } from './reveal'
import {
  claudeReply,
  envFor,
  modelPolishJson,
  modelStoryJson,
  runAction,
  seedDraft,
  seedFilledBlanks,
  seedGame,
} from './testSeed'

const WORDS = ['otter', 'wobbly', 'a barn', 'toast', 'spoon', 'bonk']

/** A lobby with host + one player, ready for startGame. */
async function lobby(tools: FakeTools) {
  const gameId = await seedGame(tools, { phase: 'lobby', filledCount: 0, totalBlanks: 0, phaseEndsAt: 0 })
  return gameId
}

const deps = (enabled: boolean): GenDeps & { queued: string[] } => {
  const queued: string[] = []
  return { enabled, queued, enqueueImages: async (id) => void queued.push(id) }
}

describe('generationEnabled (kill switch)', () => {
  it('is ON by default and only the string "false" turns it off', () => {
    expect(generationEnabled({})).toBe(true)
    expect(generationEnabled({ GENERATION_ENABLED: 'true' })).toBe(true)
    expect(generationEnabled({ GENERATION_ENABLED: 'anything' })).toBe(true)
    expect(generationEnabled({ GENERATION_ENABLED: 'false' })).toBe(false)
    expect(generationEnabled({ GENERATION_ENABLED: ' FALSE ' })).toBe(false)
  })
})

describe('askClaude', () => {
  it('returns null instead of hanging when the model is too slow', async () => {
    const t = createFakeTools()
    t.onIntegration(() => new Promise(() => {})) // never answers
    expect(await askClaude(t, 'sys', 'user', 10, 20)).toBeNull()
  })
  it('extracts the text block from the Anthropic response shape', async () => {
    const t = createFakeTools()
    t.onIntegration(() => claudeReply('hello'))
    expect(await askClaude(t, 'sys', 'user', 10)).toBe('hello')
    const body = t.integrationCalls[0].body
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.system).toBe('sys')
  })
})

describe('startGame story drafting', () => {
  it('lets only the host pick a known theme in the lobby and locks the selection on start', async () => {
    const t = createFakeTools('host')
    const gameId = await lobby(t)
    expect(await runAction(setStoryTheme, 'p2', t, { gameId, theme: 'space' })).toMatchObject({ success: false })
    expect(await runAction(setStoryTheme, 'host', t, { gameId, theme: 'invented' })).toMatchObject({ success: false })
    expect(await runAction(setStoryTheme, 'host', t, { gameId, theme: 'space' })).toMatchObject({ success: true })
    expect(t.rows('games')[0].data.lobbyTheme).toBe('space')
    expect(await runAction(startGame, 'host', t, { gameId, theme: 'invented' })).toMatchObject({ success: false })
    expect(await runAction(startGame, 'host', t, { gameId }, envFor(false))).toMatchObject({ success: true })
    expect(t.rows('games')[0].data).toMatchObject({ phase: 'filling', storyTheme: 'space' })
    expect(t.rows('blanks').map(({ data }) => data.label)).toContain('a made-up planet name')
    expect(t.rows('storyDrafts')[0].data.title).toBe('Pip and the Crater Caper')
    expect(await runAction(setStoryTheme, 'host', t, { gameId, theme: 'quest' })).toMatchObject({ success: false })
    expect(t.integrationCalls).toHaveLength(0)
  })

  it('uses the host’s explicit choice for generation and refuses changes during the start claim', async () => {
    const t = createFakeTools('host')
    const gameId = await lobby(t)
    await runAction(setStoryTheme, 'host', t, { gameId, theme: 'space' })
    t.onIntegration(async ({ body }) => {
      expect(body.messages).toEqual([expect.objectContaining({
        content: expect.stringContaining('Story theme: Tiny Quest.'),
      })])
      expect(await runAction(setStoryTheme, 'host', t, { gameId, theme: 'silly' })).toMatchObject({ success: false })
      return claudeReply(modelStoryJson())
    })
    expect(await runAction(startGame, 'host', t, { gameId, theme: 'quest' }, envFor(true))).toMatchObject({ success: true })
    expect(t.rows('games')[0].data).toMatchObject({ storyTheme: 'quest', lobbyTheme: 'space' })
    expect(t.rows('storyDrafts')[0].data.source).toBe('model')
    expect(t.integrationCalls).toHaveLength(1)
  })

  it('uses the model story: labels on blanks, safety/prompts stored in the draft', async () => {
    const t = createFakeTools('host')
    const gameId = await lobby(t)
    t.onIntegration(() => claudeReply(modelStoryJson()))
    const r = await runAction(startGame, 'host', t, { gameId }, envFor(true))
    expect(r.success).toBe(true)
    expect(t.integrationCalls.map((c) => c.endpoint)).toEqual(['anthropic/chat-completion']) // ONE call
    expect(t.rows('blanks').map((b) => b.data.label).sort()).toEqual(modelStoryJson().blanks.map((b) => b.label).sort())
    const draft = t.rows('storyDrafts')[0].data
    expect(draft.source).toBe('model')
    expect((draft.safety as string[][])[0]).toContain('otter')
    expect(t.rows('games')[0].data.phase).toBe('filling')
    expect(t.rows('spendLedger').map((l) => l.data.kind)).toEqual(['llm-story'])
  })

  const fallbackCases: [string, (t: FakeTools) => void | Promise<void>, boolean][] = [
    ['invalid JSON', (t) => t.onIntegration(() => claudeReply('not json at all')), true],
    ['a story missing a blank', (t) => t.onIntegration(() => claudeReply({ ...modelStoryJson(), blanks: modelStoryJson().blanks.slice(1) })), true],
    ['an integration error', (t) => t.onIntegration(() => ({ success: false, error: 'upstream 500' })), true],
    ['an integration that throws', (t) => t.onIntegration(() => { throw new Error('network') }), true],
    ['the spend cap being reached', async (t) => {
      t.onIntegration(() => claudeReply(modelStoryJson()))
      await t.create('spendLedger', { kind: 'image', credits: GENERATION_CAP_CREDITS, gameId: 'old', ref: 'x' })
    }, false],
  ]
  for (const [name, setup, callsModel] of fallbackCases) {
    it(`falls back to the fixed story on ${name}`, async () => {
      const t = createFakeTools('host')
      const gameId = await lobby(t)
      await setup(t)
      const r = await runAction(startGame, 'host', t, { gameId }, envFor(true))
      expect(r.success).toBe(true)
      expect(t.rows('storyDrafts')[0].data.source).toBe('fixed')
      expect(t.rows('blanks').map((b) => b.data.label)).toContain('an animal')
      expect(t.rows('games')[0].data.phase).toBe('filling')
      expect(t.integrationCalls.length > 0).toBe(callsModel)
    }, 30_000)
  }

  it('makes no model call at all when generation is switched off', async () => {
    const t = createFakeTools('host')
    const gameId = await lobby(t)
    await runAction(startGame, 'host', t, { gameId }, envFor(false))
    expect(t.integrationCalls).toHaveLength(0)
    expect(t.rows('spendLedger')).toHaveLength(0)
    expect(t.rows('storyDrafts')[0].data.source).toBe('fixed')
  })

  it('starts the 75 s timer only after the blanks exist', async () => {
    const t = createFakeTools('host')
    const gameId = await lobby(t)
    t.onIntegration(async () => {
      expect(t.rows('blanks')).toHaveLength(0) // still drafting: no blanks, no timer
      expect(t.rows('games')[0].data.phase).toBe('lobby')
      return claudeReply(modelStoryJson())
    })
    await runAction(startGame, 'host', t, { gameId }, envFor(true))
    expect(t.rows('blanks')).toHaveLength(6)
    expect(t.rows('games')[0].data.pageCount).toBe(6)
    expect(t.rows('games')[0].data.phaseEndsAt as number).toBeGreaterThan(Date.now())
  })
})

describe('reveal', () => {
  async function filledGame(t: FakeTools) {
    const gameId = await seedGame(t)
    await seedDraft(t, gameId)
    await seedFilledBlanks(t, gameId, WORDS)
    return gameId
  }

  it('stage 1: polished pages are stored, prompts kept server-side, image job queued', async () => {
    const t = createFakeTools('host')
    const gameId = await filledGame(t)
    t.onIntegration(() => claudeReply(modelPolishJson(true)))
    const d = deps(true)
    await reveal(t, gameId, d)

    expect(t.rows('pages').map((p) => p.data.imageStatus)).toEqual(Array(PAGE_COUNT).fill('pending'))
    expect(t.rows('pages')[0].data.text).toBe('Final text 0.')
    expect(t.rows('games')[0].data.phase).toBe('generating')
    expect((t.rows('storyDrafts')[0].data.finalPrompts as string[])[0]).toBe('Pip scene 0, friendly')
    expect(d.queued).toEqual([gameId])
    // the player words were sent to the polish call only, as data
    const calls = t.integrationCalls
    expect(calls.map((c) => c.endpoint)).toEqual(['anthropic/chat-completion'])
    expect(JSON.stringify(calls[0].body)).toContain('wobbly')
    // pages never carry image prompts (clients can read pages)
    expect(JSON.stringify(t.rows('pages').map((p) => p.data))).not.toContain('Pip scene')
  })

  it('polishes an existing four-page draft at its original length', async () => {
    const t = createFakeTools('host')
    const gameId = await seedGame(t)
    const legacy = modelStoryJson().pages.slice(0, 4)
    await seedDraft(t, gameId, {
      pages: legacy.map(({ text }) => text),
      imagePrompts: legacy.map(({ imagePrompt }) => imagePrompt),
    })
    await seedFilledBlanks(t, gameId, WORDS)
    t.onIntegration(() => claudeReply(modelPolishJson(true, 4)))
    const d = deps(true)
    await reveal(t, gameId, d)
    expect(t.rows('games')[0].data).toMatchObject({ phase: 'generating', pageCount: 4 })
    expect(t.rows('pages').map((row) => row.data.text)).toEqual(['Final text 0.', 'Final text 1.', 'Final text 2.', 'Final text 3.'])
    expect(d.queued).toEqual([gameId])
  })

  const noImageCases: [string, (t: FakeTools) => void | Promise<void>, boolean][] = [
    ['the polish call fails', (t) => t.onIntegration(() => ({ success: false, error: 'down' })), true],
    ['the polish output is invalid', (t) => t.onIntegration(() => claudeReply({ pages: [] })), true],
    ['the spend cap is reached', async (t) => {
      t.onIntegration(() => claudeReply(modelPolishJson()))
      await t.create('spendLedger', { kind: 'image', credits: GENERATION_CAP_CREDITS - COST_ESTIMATE_CREDITS['llm-final'] + 1, gameId: 'old', ref: 'x' })
    }, false],
  ]
  for (const [name, setup, callsModel] of noImageCases) {
    it(`shows plain text with every page 'skipped' and calls no image model when ${name}`, async () => {
      const t = createFakeTools('host')
      const gameId = await filledGame(t)
      await setup(t)
      const d = deps(true)
      await reveal(t, gameId, d)
      expect(t.rows('pages').map((p) => p.data.imageStatus)).toEqual(Array(PAGE_COUNT).fill('skipped'))
      expect(t.rows('pages')[0].data.text).toContain('wobbly') // plain substituted text
      expect(t.rows('games')[0].data.phase).toBe('ready')
      expect(d.queued).toHaveLength(0)
      expect(t.integrationCalls.some((c) => c.endpoint.startsWith('fal/'))).toBe(false)
      expect(t.integrationCalls.length > 0).toBe(callsModel)
    })
  }

  it('does everything with no model call and no spend when generation is off', async () => {
    const t = createFakeTools('host')
    const gameId = await filledGame(t)
    const d = deps(false)
    await reveal(t, gameId, d)
    expect(t.integrationCalls).toHaveLength(0)
    expect(t.rows('spendLedger')).toHaveLength(0)
    expect(t.rows('pages').map((p) => p.data.imageStatus)).toEqual(Array(PAGE_COUNT).fill('skipped'))
    expect(t.rows('games')[0].data.phase).toBe('ready')
  })

  it('concurrent reveals make exactly ONE polish call and one set of pages', async () => {
    const t = createFakeTools('host')
    const gameId = await filledGame(t)
    t.onIntegration(() => claudeReply(modelPolishJson()))
    const d = deps(true)
    await Promise.all([reveal(t, gameId, d), reveal(t, gameId, d), reveal(t, gameId, d)])
    expect(t.integrationCalls).toHaveLength(1)
    expect(t.rows('pages')).toHaveLength(PAGE_COUNT)
    expect(d.queued).toHaveLength(1)
  })

  it('marks pages failed (retryable) if the job cannot be queued', async () => {
    const t = createFakeTools('host')
    const gameId = await filledGame(t)
    t.onIntegration(() => claudeReply(modelPolishJson()))
    await reveal(t, gameId, { enabled: true, enqueueImages: async () => { throw new Error('queue down') } })
    expect(t.rows('pages').map((p) => p.data.imageStatus)).toEqual(Array(PAGE_COUNT).fill('failed'))
    expect(t.rows('games')[0].data.phase).toBe('ready')
  })
})
