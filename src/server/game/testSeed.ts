/** Test helpers: seed games/blanks/drafts/pages into a fake tools object. Unit tests only. */

import type { FakeTools } from './fakeTools'
import type { GameAction } from './helpers'
import type { GameEnv } from './deps'
import { fixedStory } from './story'

export function envFor(generation: boolean): GameEnv {
  return { DEEPSPACE_APP_ID: 'app', JOB_ROOMS: undefined as never, GENERATION_ENABLED: generation ? 'true' : 'false' }
}

export const runAction = (
  h: GameAction,
  userId: string,
  tools: FakeTools,
  params: Record<string, unknown>,
  env: GameEnv = envFor(false),
) => h({ userId, params, tools, env, callerJwt: '' })

export async function seedGame(
  tools: FakeTools,
  over: Record<string, unknown> = {},
): Promise<string> {
  const g = await tools.create('games', {
    code: `C${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    hostId: 'host',
    phase: 'filling',
    playerIds: ['host', 'p2'],
    playerNames: { host: 'Host', p2: 'Pat' },
    phaseEndsAt: Date.now() + 60_000,
    expiresAt: Date.now() + 3_600_000,
    filledCount: 6,
    totalBlanks: 6,
    title: '',
    ...over,
  })
  if (!g.success) throw new Error('seed game')
  const gameId = g.data.recordId
  await tools.create('memberships', { gameId, userId: 'host', name: 'Host' })
  await tools.create('memberships', { gameId, userId: 'p2', name: 'Pat' })
  return gameId
}

/** A story draft (the fixed story by default). */
export async function seedDraft(tools: FakeTools, gameId: string, extra: Record<string, unknown> = {}) {
  const f = fixedStory()
  await tools.create('storyDrafts', { gameId, ...f, finalPrompts: [], ...extra })
}

/** Six filled blanks with the given words, dealt to host/p2. */
export async function seedFilledBlanks(tools: FakeTools, gameId: string, words: string[]) {
  const f = fixedStory()
  for (let i = 0; i < 6; i++) {
    await tools.create('blanks', {
      gameId,
      idx: i,
      label: f.labels[i],
      value: words[i],
      filled: 1,
      source: 'player',
      assignedTo: i % 2 ? 'p2' : 'host',
    })
  }
}

export async function seedPages(tools: FakeTools, gameId: string, statuses: string[], retries = 0) {
  for (let idx = 0; idx < statuses.length; idx++) {
    await tools.create('pages', {
      gameId,
      idx,
      text: `page ${idx}`,
      imageUrl: '',
      imageStatus: statuses[idx],
      retries,
      playerIds: ['host', 'p2'],
    })
  }
}

/** Valid story-draft JSON as the model would return it. */
export function modelStoryJson() {
  return {
    title: 'Pip and the Wobbly Moon',
    blanks: [
      { label: 'an animal', safety: ['otter', 'yak', 'newt', 'moth', 'lynx'] },
      { label: 'a silly adjective', safety: ['floppy', 'zesty', 'wiggly', 'squeaky', 'bouncy'] },
      { label: 'a place', safety: ['a barn', 'the beach', 'a cave', 'a boat', 'a kite'] },
      { label: 'a food', safety: ['toast', 'soup', 'jam', 'rice', 'plum'] },
      { label: 'an object', safety: ['spoon', 'sock', 'lamp', 'drum', 'shoe'] },
      { label: 'a sound', safety: ['zoink', 'pop', 'bonk', 'fwoosh', 'ding'] },
    ],
    pages: [
      { text: 'Pip the {1} {0} lived in {2}.', imagePrompt: 'Pip, a small blue creature, a {1} {0} in {2}' },
      { text: 'Pip loved {3} more than anything.', imagePrompt: 'Pip eating {3}' },
      { text: 'One day a {4} went {5}!', imagePrompt: 'Pip surprised by a {4}' },
      { text: 'Pip waved goodbye to the {4}.', imagePrompt: 'Pip waving at a {4}, {5} sound lines' },
    ],
  }
}

export const modelPolishJson = (rewritten = false) => ({
  pages: [0, 1, 2, 3].map((i) => ({ text: `Final text ${i}.`, imagePrompt: `Pip scene ${i}, friendly` })),
  rewritten,
})

/** Wraps JSON the way anthropic/chat-completion returns it. */
export const claudeReply = (payload: unknown) => ({
  success: true as const,
  data: { content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }] },
})
