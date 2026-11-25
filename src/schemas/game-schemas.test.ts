import { describe, expect, it } from 'vitest'
import { canRead, lintSchemas } from 'deepspace/worker'
import { schemas } from '../schemas'

describe('game schemas', () => {
  it('pass the SDK schema lint with no warnings', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })

  it('no client role can create, update or (non-admin) delete game records', () => {
    for (const s of schemas.filter((x) => ['games', 'memberships', 'blanks', 'storyDrafts', 'pages'].includes(x.name))) {
      for (const [role, p] of Object.entries(s.permissions)) {
        expect(p.create, `${s.name}.${role}.create`).toBe(false)
        expect(p.update, `${s.name}.${role}.update`).toBe(false)
        if (role !== 'admin') expect(p.delete, `${s.name}.${role}.delete`).toBe(false)
      }
    }
  })

  it('games carry a numeric expiresAt column for room expiry', () => {
    const games = schemas.find((s) => s.name === 'games')!
    expect(games.columns.find((c) => c.name === 'expiresAt')).toMatchObject({ storage: 'number' })
  })

  it('blanks are hidden from everyone but their assignee; drafts from everyone', () => {
    const blanks = schemas.find((s) => s.name === 'blanks')!
    expect(blanks.permissions.member.read).toBe('own')
    expect(blanks.ownerField).toBe('assignedTo')
    expect(blanks.permissions.admin.read).toBe('own')
    expect(blanks.permissions.viewer.read).toBe(false)
    expect(blanks.permissions['*'].read).toBe(false)

    const drafts = schemas.find((s) => s.name === 'storyDrafts')!
    for (const p of Object.values(drafts.permissions)) expect(p.read).toBe(false)
  })

  // Regression: the app owner is automatically an `admin`, and with
  // `blanks.admin.read = false` the owner could not see their OWN blanks when
  // they played ("you have no blanks this round"). Tests that only use
  // `member` accounts could not catch it, so check the real SDK permission
  // function for every role.
  it('each role can read exactly the blanks dealt to it, as the SDK evaluates them', () => {
    const blanks = schemas.find((s) => s.name === 'blanks')!
    const mine = { data: { assignedTo: 'user-a' }, createdBy: 'someone-else' }
    const theirs = { data: { assignedTo: 'user-b' }, createdBy: 'someone-else' }

    for (const role of ['member', 'admin']) {
      expect(canRead(blanks, role, mine, 'user-a'), `${role} reads own blank`).toBe(true)
      expect(canRead(blanks, role, theirs, 'user-a'), `${role} reads another's blank`).toBe(false)
    }
    for (const role of ['viewer', '*']) {
      expect(canRead(blanks, role, mine, 'user-a'), `${role} reads a blank`).toBe(false)
    }

    // Nobody, admin included, can read the unrevealed story template.
    const drafts = schemas.find((s) => s.name === 'storyDrafts')!
    const draft = { data: { gameId: 'g1' }, createdBy: 'user-a' }
    for (const role of ['member', 'admin', 'viewer', '*']) {
      expect(canRead(drafts, role, draft, 'user-a'), `${role} reads a story draft`).toBe(false)
    }
  })

  // The app owner is automatically an admin AND plays, so "admin can read" must
  // be checked deliberately per collection. These hold server-only data.
  it('no role (admin/owner included) can read or write the spend ledger or story drafts', () => {
    for (const name of ['spendLedger', 'storyDrafts']) {
      const c = schemas.find((s) => s.name === name)!
      const row = { data: { gameId: 'g1' }, createdBy: 'user-a' }
      for (const role of ['member', 'admin', 'viewer', '*']) {
        expect(canRead(c, role, row, 'user-a'), `${role} reads ${name}`).toBe(false)
        expect(c.permissions[role]).toMatchObject({ create: false, update: false, delete: false })
      }
    }
  })

  it('pages: players (and admin) read them; the image status is a declared select', () => {
    const pages = schemas.find((s) => s.name === 'pages')!
    const row = { data: { playerIds: ['user-a'] }, createdBy: 'server' }
    expect(canRead(pages, 'member', row, 'user-a')).toBe(true)
    expect(canRead(pages, 'member', row, 'outsider')).toBe(false)
    const status = pages.columns.find((c) => c.name === 'imageStatus')!
    expect(status.interpretation).toEqual({
      kind: 'select',
      options: ['pending', 'generating', 'ready', 'failed', 'skipped'],
    })
    expect(pages.columns.find((c) => c.name === 'retries')).toMatchObject({ storage: 'number', default: 0 })
  })

  it('games.phase still declares the later phases', () => {
    const games = schemas.find((s) => s.name === 'games')!
    const phase = games.columns.find((c) => c.name === 'phase')!.interpretation as { options: string[] }
    for (const p of ['lobby', 'filling', 'generating', 'ready', 'failed', 'revealed']) expect(phase.options).toContain(p)
  })
})
