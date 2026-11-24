/**
 * Drives the real actions against the in-memory fake: an expired room is
 * refused by EVERY action that touches a game, immediately, with no cleanup
 * having run. No test-only code in production: the expired room is simply a
 * game record whose expiresAt is in the past.
 */
import { describe, expect, it } from 'vitest'
import { ROOM_TTL_MS } from '../../game'
import { createGame, joinGame, startGame, submitBlank, tick, useSafetyWord } from './actions'
import { createFakeTools } from './fakeTools'
import type { FakeTools } from './fakeTools'
import type { GameAction } from './helpers'

const run = (h: GameAction, userId: string, tools: FakeTools, params: Record<string, unknown>) =>
  h({ userId, params, tools, env: {}, callerJwt: '' })

async function expiredRoom() {
  const tools = createFakeTools('host')
  const game = await tools.create('games', {
    code: 'ABCDE',
    hostId: 'host',
    phase: 'filling',
    playerIds: ['host'],
    playerNames: { host: 'Host' },
    phaseEndsAt: Date.now() + 60_000, // timer still running: only expiry can refuse
    expiresAt: Date.now() - 1,
    filledCount: 0,
    totalBlanks: 6,
  })
  if (!game.success) throw new Error('seed')
  const gameId = game.data.recordId
  await tools.create('memberships', { gameId, userId: 'host', name: 'Host' })
  const blank = await tools.create('blanks', { gameId, idx: 0, label: 'an animal', filled: 0, assignedTo: 'host' })
  if (!blank.success) throw new Error('seed')
  return { tools, gameId, blankId: blank.data.recordId }
}

describe('expired rooms', () => {
  it('are refused by joinGame, startGame, submitBlank, useSafetyWord and tick', async () => {
    const { tools, gameId, blankId } = await expiredRoom()
    const results = await Promise.all([
      run(joinGame, 'newbie', tools, { code: 'ABCDE', name: 'New' }),
      run(startGame, 'host', tools, { gameId }),
      run(submitBlank, 'host', tools, { blankId, value: 'cat' }),
      run(useSafetyWord, 'host', tools, { blankId }),
      run(tick, 'host', tools, { gameId }),
    ])
    for (const r of results) expect(r).toEqual({ success: false, error: 'This room has expired.' })
    expect(tools.rows('blanks')[0].data.filled).toBe(0) // and nothing was written
  })
})

describe('createGame', () => {
  it('stamps expiresAt = now + ROOM_TTL_MS', async () => {
    const tools = createFakeTools('host')
    const before = Date.now()
    const r = await run(createGame, 'host', tools, { name: 'Host' })
    expect(r.success).toBe(true)
    const exp = tools.rows('games')[0].data.expiresAt as number
    expect(exp).toBeGreaterThanOrEqual(before + ROOM_TTL_MS)
    expect(exp).toBeLessThanOrEqual(Date.now() + ROOM_TTL_MS)
  })

  it('sweeps expired rooms first, then refuses the 6th room in the window with the rate message', async () => {
    const tools = createFakeTools('host')
    await tools.create('games', { code: 'OLDXX', hostId: 'host', expiresAt: 1 }) // expired leftover
    for (let i = 0; i < 5; i++) expect((await run(createGame, 'host', tools, { name: 'H' })).success).toBe(true)
    expect(tools.rows('games').some((g) => g.data.code === 'OLDXX')).toBe(false) // swept opportunistically
    const sixth = await run(createGame, 'host', tools, { name: 'H' })
    expect(sixth.success).toBe(false)
    expect(sixth.success === false && sixth.error).toMatch(/too quickly.*minute/)
  })
})
