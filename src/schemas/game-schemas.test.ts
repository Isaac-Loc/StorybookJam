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
})
