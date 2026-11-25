/**
 * Generation spend caps.
 *
 * Two ceilings on ESTIMATED credits (COST_ESTIMATE_CREDITS), kept in the
 * server-only `spendLedger` collection: a global one (GENERATION_CAP_CREDITS)
 * and a per-host one (HOST_CAP_CREDITS) so one account cannot burn it all.
 * The ledger holds estimates, and no role can read it: the owner checks REAL
 * spend with `npx deepspace app usage --json`.
 *
 * To spend, a caller RESERVES first and calls the paid API only if the
 * reservation holds:
 *
 *   1. write the reservation row (unique per gameId + kind + ref),
 *   2. sum the whole ledger (which now includes our own row),
 *   3. if either total exceeds its cap, delete our own row and report over budget.
 *
 * Because every spender writes BEFORE it reads, two concurrent spenders can
 * never both slip under a cap: at least the later reader sees both rows. The
 * price is that two spenders racing at the very edge may BOTH back out (fail
 * closed), which only ever wastes headroom, never overspends it.
 * Same back-out idea as joinGame's rank check.
 */

import { COST_ESTIMATE_CREDITS, GENERATION_CAP_CREDITS, HOST_CAP_CREDITS } from '../../game'
import type { SpendKind } from '../../game'
import { isDuplicate } from './helpers'
import type { Tools } from './helpers'

/** A total that is exactly at the cap is still allowed. */
export function withinCap(totalCredits: number, cap: number = GENERATION_CAP_CREDITS): boolean {
  return totalCredits <= cap
}

export function ledgerTotal(rows: readonly { credits: number }[]): number {
  return rows.reduce((sum, r) => sum + (Number.isFinite(r.credits) ? r.credits : 0), 0)
}

export type Limits = { cap: number; hostCap: number }
export const DEFAULT_LIMITS: Limits = { cap: GENERATION_CAP_CREDITS, hostCap: HOST_CAP_CREDITS }

/** Pure decision over the full ledger (which already includes the new row). */
export function withinLimits(
  rows: readonly { credits: number; userId?: string }[],
  hostId: string,
  limits: Limits = DEFAULT_LIMITS,
): boolean {
  return withinCap(ledgerTotal(rows), limits.cap) && withinCap(ledgerTotal(rows.filter((r) => r.userId === hostId)), limits.hostCap)
}

/** Most rows we will read. The ledger holds at most ~cap/2 rows (200), so hitting this means "fail closed". */
export const LEDGER_READ_LIMIT = 1000

export type Reservation = 'ok' | 'over_budget' | 'duplicate'

type LedgerRow = { kind: SpendKind; credits: number; gameId: string; userId: string; ref: string }

export async function reserveSpend(
  tools: Tools,
  kind: SpendKind,
  gameId: string,
  ref: string,
  hostId: string,
  limits: Limits = DEFAULT_LIMITS,
): Promise<Reservation> {
  const row: LedgerRow = { kind, credits: COST_ESTIMATE_CREDITS[kind], gameId, userId: hostId, ref }
  const created = await tools.create<LedgerRow>('spendLedger', row)
  if (!created.success) return isDuplicate(created) ? 'duplicate' : 'over_budget' // can't record => can't spend

  const all = await tools.query<LedgerRow>('spendLedger', { limit: LEDGER_READ_LIMIT })
  const complete = all.success && all.data.records.length < LEDGER_READ_LIMIT
  if (complete && withinLimits(all.data.records.map((r) => r.data), hostId, limits)) return 'ok'

  await tools.remove('spendLedger', created.data.recordId) // back out our own reservation
  return 'over_budget'
}
