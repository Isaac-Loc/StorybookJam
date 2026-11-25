import { describe, expect, it } from 'vitest'
import { cleanupExpiredGames } from './cleanup'
import { createFakeTools } from './fakeTools'
import type { FakeTools } from './fakeTools'

const NOW = 1_000_000
let seq = 0 // rooms need unique codes (the fake enforces uniqueOn like the real DO)

/** A room plus one row in every child collection. */
async function seedRoom(tools: FakeTools, expiresAt: number, extraBlanks = 0) {
  const g = await tools.create('games', { code: `X${++seq}`, hostId: 'h', expiresAt })
  if (!g.success) throw new Error('seed failed')
  const gameId = g.data.recordId
  await tools.create('memberships', { gameId, userId: 'h' })
  for (let i = 0; i < 1 + extraBlanks; i++) await tools.create('blanks', { gameId, idx: i })
  await tools.create('storyDrafts', { gameId })
  await tools.create('pages', { gameId, idx: 0 })
  // Spend for this room: must outlive the room (see the ledger test below).
  await tools.create('spendLedger', { kind: 'image', credits: 2, gameId, ref: 'p0-r0-a1' })
  return gameId
}

const count = (t: FakeTools, c: string, gameId: string) =>
  t.rows(c).filter((r) => r.data.gameId === gameId).length

const CHILDREN = ['memberships', 'blanks', 'storyDrafts', 'pages']

describe('cleanupExpiredGames', () => {
  it('deletes expired rooms and ALL their children, leaving live rooms and their children alone', async () => {
    const t = createFakeTools()
    const dead = await seedRoom(t, NOW - 1)
    const deadAtBoundary = await seedRoom(t, NOW) // expires exactly now => expired
    const live = await seedRoom(t, NOW + 1)

    const res = await cleanupExpiredGames(t, NOW, 10)
    expect(res.roomsDeleted).toBe(2)

    for (const id of [dead, deadAtBoundary]) {
      expect(t.rows('games').some((g) => g.recordId === id)).toBe(false)
      for (const c of CHILDREN) expect(count(t, c, id)).toBe(0)
    }
    expect(t.rows('games').map((g) => g.recordId)).toEqual([live])
    for (const c of CHILDREN) expect(count(t, c, live)).toBe(1)
  })

  it('never touches the spend ledger, so expiry cannot reset the spend', async () => {
    const t = createFakeTools()
    await seedRoom(t, NOW - 1)
    await seedRoom(t, NOW - 2)
    await cleanupExpiredGames(t, NOW, 10)
    expect(t.rows('games')).toHaveLength(0)
    expect(t.rows('spendLedger')).toHaveLength(2)
  })

  it('is idempotent: a second run changes nothing', async () => {
    const t = createFakeTools()
    await seedRoom(t, NOW - 5)
    const live = await seedRoom(t, NOW + 5)
    await cleanupExpiredGames(t, NOW, 10)
    const snapshot = JSON.stringify([t.rows('games'), t.rows('blanks'), t.rows('pages')])
    const again = await cleanupExpiredGames(t, NOW, 10)
    expect(again.roomsDeleted).toBe(0)
    expect(JSON.stringify([t.rows('games'), t.rows('blanks'), t.rows('pages')])).toBe(snapshot)
    expect(count(t, 'blanks', live)).toBe(1)
  })

  it('respects the per-run bound and finishes the backlog on later runs', async () => {
    const t = createFakeTools()
    for (let i = 0; i < 5; i++) await seedRoom(t, NOW - 10 + i)
    expect((await cleanupExpiredGames(t, NOW, 2)).roomsDeleted).toBe(2)
    expect(t.rows('games')).toHaveLength(3)
    expect((await cleanupExpiredGames(t, NOW, 2)).roomsDeleted).toBe(2)
    expect((await cleanupExpiredGames(t, NOW, 2)).roomsDeleted).toBe(1)
    expect(t.rows('games')).toHaveLength(0)
  })

  it('drains a room with more child rows than one deleteWhere page', async () => {
    const t = createFakeTools()
    const big = await seedRoom(t, NOW - 1, 250) // 251 blanks
    await cleanupExpiredGames(t, NOW, 5)
    expect(count(t, 'blanks', big)).toBe(0)
    expect(t.rows('games')).toHaveLength(0)
  })

  it('sweeps legacy rooms that have no expiresAt', async () => {
    const t = createFakeTools()
    await t.create('games', { code: 'OLD', hostId: 'h' })
    expect((await cleanupExpiredGames(t, NOW, 5)).roomsDeleted).toBe(1)
  })
})
