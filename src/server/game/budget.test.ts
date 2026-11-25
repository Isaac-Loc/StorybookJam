import { describe, expect, it } from 'vitest'
import { COST_ESTIMATE_CREDITS, GENERATION_CAP_CREDITS, HOST_CAP_CREDITS } from '../../game'
import { ledgerTotal, reserveSpend, withinCap, withinLimits } from './budget'
import { createFakeTools } from './fakeTools'
import type { FakeTools } from './fakeTools'

describe('withinCap / ledgerTotal / withinLimits', () => {
  it('allows exactly the cap and refuses one more', () => {
    expect(withinCap(GENERATION_CAP_CREDITS)).toBe(true)
    expect(withinCap(GENERATION_CAP_CREDITS + 1)).toBe(false)
    expect(withinCap(0)).toBe(true)
  })
  it('sums credits, ignoring junk values', () => {
    expect(ledgerTotal([{ credits: 2 }, { credits: 3 }, { credits: Number.NaN }])).toBe(5)
    expect(ledgerTotal([])).toBe(0)
  })
  it('checks the global and the per-host total independently', () => {
    const rows = [{ credits: 6, userId: 'a' }, { credits: 5, userId: 'b' }]
    expect(withinLimits(rows, 'a', { cap: 11, hostCap: 6 })).toBe(true) // both exactly at their caps
    expect(withinLimits(rows, 'a', { cap: 10, hostCap: 6 })).toBe(false) // global over
    expect(withinLimits(rows, 'a', { cap: 11, hostCap: 5 })).toBe(false) // host over
    expect(withinLimits(rows, 'b', { cap: 11, hostCap: 5 })).toBe(true) // other host unaffected
  })
  it('the host cap sits inside the global cap', () => {
    expect(HOST_CAP_CREDITS).toBeLessThan(GENERATION_CAP_CREDITS)
  })
})

/** Ledger already holding `credits` of spend (1-credit rows) for `userId`. */
async function ledgerWith(credits: number, userId = 'host'): Promise<FakeTools> {
  const t = createFakeTools()
  for (let i = 0; i < credits; i++) {
    await t.create('spendLedger', { kind: 'image', credits: 1, gameId: 'old', userId, ref: `r${i}` })
  }
  return t
}

describe('reserveSpend', () => {
  const need = COST_ESTIMATE_CREDITS.image // 2
  const lim = (cap: number, hostCap = 1000) => ({ cap, hostCap })

  it('reserves while the new total stays at or under the cap', async () => {
    const t = await ledgerWith(10 - need)
    expect(await reserveSpend(t, 'image', 'g', 'a', 'host', lim(10))).toBe('ok')
    expect(t.rows('spendLedger')).toHaveLength(10 - need + 1)
  })

  it('refuses one credit over the cap and removes its own reservation row', async () => {
    const t = await ledgerWith(10 - need + 1)
    expect(await reserveSpend(t, 'image', 'g', 'a', 'host', lim(10))).toBe('over_budget')
    expect(t.rows('spendLedger')).toHaveLength(10 - need + 1)
  })

  it('enforces the PER-HOST cap at its boundary, and other hosts are unaffected', async () => {
    const t = await ledgerWith(10 - need, 'host') // host at 8 of 10
    expect(await reserveSpend(t, 'image', 'g1', 'a', 'host', lim(1000, 10))).toBe('ok') // exactly 10
    expect(await reserveSpend(t, 'image', 'g1', 'b', 'host', lim(1000, 10))).toBe('over_budget') // 12 > 10
    expect(await reserveSpend(t, 'image', 'g2', 'a', 'other', lim(1000, 10))).toBe('ok') // different host
    expect(t.rows('spendLedger').filter((r) => r.data.userId === 'host')).toHaveLength(10 - need + 1)
  })

  it('records the host id on every row', async () => {
    const t = createFakeTools()
    await reserveSpend(t, 'llm-story', 'g', 'story', 'h1')
    expect(t.rows('spendLedger')[0].data).toMatchObject({
      userId: 'h1',
      gameId: 'g',
      credits: COST_ESTIMATE_CREDITS['llm-story'],
    })
  })

  it('reports a repeated reservation as duplicate and keeps the original', async () => {
    const t = createFakeTools()
    expect(await reserveSpend(t, 'llm-final', 'g', 'final', 'h')).toBe('ok')
    expect(await reserveSpend(t, 'llm-final', 'g', 'final', 'h')).toBe('duplicate')
    expect(t.rows('spendLedger')).toHaveLength(1)
  })

  it('concurrent spenders racing for the last slot can never both succeed', async () => {
    const t = await ledgerWith(10 - need)
    const results = await Promise.all([
      reserveSpend(t, 'image', 'g1', 'a', 'x', lim(10)),
      reserveSpend(t, 'image', 'g2', 'a', 'y', lim(10)),
    ])
    expect(results.filter((r) => r === 'ok').length).toBeLessThanOrEqual(1)
    expect(ledgerTotal(t.rows('spendLedger').map((r) => r.data as { credits: number }))).toBeLessThanOrEqual(10)
  })

  it('fails closed when the ledger cannot be read in full', async () => {
    const t = createFakeTools()
    const real = t.query.bind(t)
    t.query = (async (c: string, o?: never) =>
      c === 'spendLedger' ? { success: false, error: 'boom' } : real(c, o)) as never
    expect(await reserveSpend(t, 'image', 'g', 'a', 'h')).toBe('over_budget')
  })
})
