/**
 * In-memory stand-in for the `ActionTools` interface, for unit tests only
 * (nothing in the Worker imports this file). Supports create / get / query
 * (equality `where`, orderBy, limit) / update / remove / deleteWhere, which is
 * everything the game actions and cleanup use. It does NOT enforce uniqueOn.
 */

import type { ActionResult, ActionTools } from 'deepspace/worker'

type Row = { recordId: string; data: Record<string, unknown>; createdBy: string; createdAt: string; updatedAt: string }

export type FakeTools = ActionTools & {
  /** All rows of a collection, for assertions. */
  rows(collection: string): Row[]
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

  const tools = {
    rows: (c: string) => [...coll(c).values()],
    async create(collection, data, recordId) {
      const id = recordId ?? `r${++counter}`
      const now = new Date().toISOString() // real clock: rate-limit logic reads createdAt
      coll(collection).set(id, { recordId: id, data: { ...data }, createdBy: userId, createdAt: now, updatedAt: now })
      return ok({ recordId: id })
    },
    async update(collection, recordId, data) {
      const row = coll(collection).get(recordId)
      if (!row) return err('Record not found')
      Object.assign(row.data, data)
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
    async integration() {
      return err('integrations are not available in the fake')
    },
    async registerUser() {
      return err('registerUser is not available in the fake')
    },
  } as FakeTools
  return tools
}
