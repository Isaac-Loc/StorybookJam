/**
 * In-memory stand-in for the `ActionTools` interface, for unit tests only
 * (nothing in the Worker imports this file). Supports create / get / query
 * (equality `where`, orderBy, limit) / update / remove / deleteWhere, which is
 * everything the game actions and cleanup use. uniqueOn IS enforced (from the real schemas).
 */

import type { ActionResult, ActionTools } from 'deepspace/worker'
import { schemas } from '../../schemas'

/** uniqueOn per collection, taken from the REAL schemas so the fake refuses duplicates like the Durable Object. */
const UNIQUE_ON = new Map(schemas.filter((s) => s.uniqueOn).map((s) => [s.name, s.uniqueOn as string[]]))

export type IntegrationCall = { endpoint: string; body: Record<string, unknown> }
export type IntegrationHandler = (call: IntegrationCall) => ActionResult<unknown> | Promise<ActionResult<unknown>>

type Row = { recordId: string; data: Record<string, unknown>; createdBy: string; createdAt: string; updatedAt: string }

export type FakeTools = ActionTools & {
  /** All rows of a collection, for assertions. */
  rows(collection: string): Row[]
  /** Every tools.integration call made, in order. */
  integrationCalls: IntegrationCall[]
  /** Script integration responses. Unscripted calls fail loudly (so tests notice stray spend). */
  onIntegration(handler: IntegrationHandler): void
}

export function createFakeTools(userId = 'u1'): FakeTools {
  const store = new Map<string, Map<string, Row>>()
  let counter = 0
  const coll = (name: string) => {
    if (!store.has(name)) store.set(name, new Map())
    return store.get(name)!
  }
  const ok = <T>(data: T): ActionResult<T> => ({ success: true, data })
  const err = (error: string): ActionResult<never> => ({ success: false, error })
  const matches = (row: Row, where?: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => row.data[k] === v || (k === 'recordId' && row.recordId === v))

  let handler: IntegrationHandler = ({ endpoint }) => err(`unscripted integration call: ${endpoint}`)
  const integrationCalls: IntegrationCall[] = []

  const tools = {
    integrationCalls,
    onIntegration: (h: IntegrationHandler) => {
      handler = h
    },
    rows: (c: string) => [...coll(c).values()],
    async create(collection, data, recordId) {
      const id = recordId ?? `r${++counter}`
      const unique = UNIQUE_ON.get(collection)
      if (unique && [...coll(collection).values()].some((r) => unique.every((f) => r.data[f] === (data as Record<string, unknown>)[f]))) {
        return err(`Duplicate: a record with ${unique.join(', ')} already exists in ${collection}`)
      }
      const now = new Date().toISOString() // real clock: rate-limit logic reads createdAt
      coll(collection).set(id, { recordId: id, data: { ...data }, createdBy: userId, createdAt: now, updatedAt: now })
      return ok({ recordId: id })
    },
    async update(collection, recordId, data) {
      const row = coll(collection).get(recordId)
      if (!row) return err('Record not found')
      Object.assign(row.data, data)
      row.updatedAt = new Date().toISOString()
      return ok({ recordId })
    },
    async remove(collection, recordId) {
      return coll(collection).delete(recordId) ? ok({ recordId }) : err('Record not found')
    },
    async deleteWhere(collection, where, limit = 100) {
      const hit = [...coll(collection).values()].filter((r) => matches(r, where)).slice(0, limit)
      for (const r of hit) coll(collection).delete(r.recordId)
      return ok({ deleted: hit.length })
    },
    async get(collection, recordId) {
      const row = coll(collection).get(recordId)
      return row ? ok({ record: structuredClone(row) as never }) : err('Record not found')
    },
    async query(collection, options) {
      let rows = [...coll(collection).values()].filter((r) => matches(r, options?.where))
      if (options?.orderBy) {
        const key = options.orderBy
        const dir = options.orderDir === 'desc' ? -1 : 1
        rows.sort((a, b) => (Number(a.data[key]) - Number(b.data[key])) * dir)
      }
      if (options?.limit !== undefined) rows = rows.slice(0, options.limit)
      return ok({ records: structuredClone(rows) as never, count: rows.length })
    },
    async integration(endpoint: string, body?: unknown) {
      const call = { endpoint, body: (body ?? {}) as Record<string, unknown> }
      integrationCalls.push(call)
      return (await handler(call)) as never
    },
    async registerUser() {
      return err('registerUser is not available in the fake')
    },
  } as FakeTools
  return tools
}
