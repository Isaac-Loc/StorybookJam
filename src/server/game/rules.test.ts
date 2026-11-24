import { describe, expect, it } from 'vitest'
import {
  CREATE_LIMIT_PER_WINDOW,
  CREATE_LIMIT_WINDOW_MS,
  MAX_ACTIVE_ROOMS_GLOBAL,
  MAX_ACTIVE_ROOMS_PER_USER,
  MAX_PLAYERS,
} from '../../game'
import { STALE_CLAIM_MS, capRoster, decideCreate, isParamsObject, isStaleClaim } from './rules'

describe('isStaleClaim', () => {
  const old = STALE_CLAIM_MS + 1
  it('is stale only for an old claim, in the lobby, with no blanks', () => {
    expect(isStaleClaim({ phase: 'lobby', blankCount: 0, claimAgeMs: old })).toBe(true)
  })
  it('is not stale when blanks exist', () => {
    expect(isStaleClaim({ phase: 'lobby', blankCount: 6, claimAgeMs: old })).toBe(false)
  })
  it('is not stale once the phase moved on', () => {
    expect(isStaleClaim({ phase: 'filling', blankCount: 0, claimAgeMs: old })).toBe(false)
    expect(isStaleClaim({ phase: 'revealed', blankCount: 0, claimAgeMs: old })).toBe(false)
  })
  it('is not stale while the claim is young (a slow start may still be running)', () => {
    expect(isStaleClaim({ phase: 'lobby', blankCount: 0, claimAgeMs: 100 })).toBe(false)
  })
})

describe('capRoster', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `m${i}`, createdAt: `2026-01-01T00:00:0${i}.000Z` }))

  it('keeps everyone when under the cap', () => {
    const { players, overflow } = capRoster(rows(3))
    expect(players).toHaveLength(3)
    expect(overflow).toHaveLength(0)
  })
  it('keeps the earliest MAX_PLAYERS regardless of input order and reports the rest', () => {
    const input = rows(MAX_PLAYERS + 2).reverse()
    const { players, overflow } = capRoster(input)
    expect(players.map((p) => p.id)).toEqual(rows(MAX_PLAYERS).map((r) => r.id))
    expect(overflow.map((p) => p.id)).toEqual([`m${MAX_PLAYERS}`, `m${MAX_PLAYERS + 1}`])
  })
  it('breaks createdAt ties by id', () => {
    const tied = [
      { id: 'b', createdAt: 'same' },
      { id: 'a', createdAt: 'same' },
    ]
    expect(capRoster(tied).players.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('isParamsObject', () => {
  it('accepts plain objects only', () => {
    expect(isParamsObject({})).toBe(true)
    expect(isParamsObject({ a: 1 })).toBe(true)
    for (const bad of [null, undefined, [], [1], 'x', 3, true]) expect(isParamsObject(bad)).toBe(false)
  })
})

describe('decideCreate', () => {
  const now = 10_000_000
  const base = { now, userCreatedAt: [] as number[], userActiveRooms: 0, globalActiveRooms: 0 }
  const recent = (n: number, ageMs = 1000) => Array.from({ length: n }, () => now - ageMs)

  it('allows a fresh user', () => {
    expect(decideCreate(base)).toEqual({ allowed: true })
  })
  it('allows one below the rate limit, refuses exactly at it', () => {
    expect(decideCreate({ ...base, userCreatedAt: recent(CREATE_LIMIT_PER_WINDOW - 1) }).allowed).toBe(true)
    const d = decideCreate({ ...base, userCreatedAt: recent(CREATE_LIMIT_PER_WINDOW) })
    expect(d).toMatchObject({ allowed: false, reason: 'rate' })
  })
  it('a room created exactly one window ago no longer counts; one ms younger still does', () => {
    const edge = Array.from({ length: CREATE_LIMIT_PER_WINDOW }, () => now - CREATE_LIMIT_WINDOW_MS)
    expect(decideCreate({ ...base, userCreatedAt: edge }).allowed).toBe(true)
    const inside = Array.from({ length: CREATE_LIMIT_PER_WINDOW }, () => now - CREATE_LIMIT_WINDOW_MS + 1)
    expect(decideCreate({ ...base, userCreatedAt: inside }).allowed).toBe(false)
  })
  it('tells the user roughly how many minutes to wait (rounded up, at least 1)', () => {
    const times = recent(CREATE_LIMIT_PER_WINDOW, 4 * 60_000) // oldest is 4 min old -> 6 min left
    const d = decideCreate({ ...base, userCreatedAt: times })
    expect(d.allowed === false && d.message).toContain('6 minutes')
    const almost = recent(CREATE_LIMIT_PER_WINDOW, CREATE_LIMIT_WINDOW_MS - 10)
    const d2 = decideCreate({ ...base, userCreatedAt: almost })
    expect(d2.allowed === false && d2.message).toContain('1 minute')
  })
  it('enforces the per-user active cap at exactly the cap', () => {
    expect(decideCreate({ ...base, userActiveRooms: MAX_ACTIVE_ROOMS_PER_USER - 1 }).allowed).toBe(true)
    expect(decideCreate({ ...base, userActiveRooms: MAX_ACTIVE_ROOMS_PER_USER })).toMatchObject({
      allowed: false,
      reason: 'user_cap',
    })
  })
  it('enforces the global cap at exactly the cap', () => {
    expect(decideCreate({ ...base, globalActiveRooms: MAX_ACTIVE_ROOMS_GLOBAL - 1 }).allowed).toBe(true)
    expect(decideCreate({ ...base, globalActiveRooms: MAX_ACTIVE_ROOMS_GLOBAL })).toMatchObject({
      allowed: false,
      reason: 'global_busy',
    })
  })
  it('gives each refusal a distinct message', () => {
    const msgs = [
      decideCreate({ ...base, userCreatedAt: recent(CREATE_LIMIT_PER_WINDOW) }),
      decideCreate({ ...base, userActiveRooms: MAX_ACTIVE_ROOMS_PER_USER }),
      decideCreate({ ...base, globalActiveRooms: MAX_ACTIVE_ROOMS_GLOBAL }),
    ].map((d) => (d.allowed ? '' : d.message))
    expect(new Set(msgs).size).toBe(3)
  })
})
