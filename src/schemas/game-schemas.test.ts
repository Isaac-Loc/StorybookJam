import { describe, expect, it } from 'vitest'
import { lintSchemas } from 'deepspace/worker'
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
    expect(blanks.permissions.admin.read).toBe(false)
    expect(blanks.permissions.viewer.read).toBe(false)
    expect(blanks.permissions['*'].read).toBe(false)

    const drafts = schemas.find((s) => s.name === 'storyDrafts')!
    for (const p of Object.values(drafts.permissions)) expect(p.read).toBe(false)
  })
})
