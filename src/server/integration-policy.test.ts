import { describe, expect, it } from 'vitest'
import { lookupOwn } from 'deepspace/worker'
import { integrations } from '../integrations'
import { decideProxy, normalizeIntegrationName } from './integration-policy'

const decide = (name: string, signedIn = true) =>
  decideProxy({ config: lookupOwn(integrations, normalizeIntegrationName(name)), signedIn })

describe('browser integration proxy policy', () => {
  it('refuses every unlisted integration (deny by default), signed in or not', () => {
    for (const n of ['openai', 'gemini', 'elevenlabs', 'exa', 'youtube', 'made-up']) {
      expect(decide(n)).toMatchObject({ allow: false, status: 403 })
      expect(decide(n, false)).toMatchObject({ allow: false, status: 403 })
    }
  })
  it('refuses the server-only spend-capped integrations, including differently-cased names', () => {
    for (const n of ['anthropic', 'fal', 'Anthropic', 'FAL', ' Fal ', 'ANTHROPIC']) {
      expect(decide(n)).toMatchObject({ allow: false, status: 403 })
    }
  })
  it('allows the listed browser integrations for a signed-in caller', () => {
    expect(decide('google')).toEqual({ allow: true, billing: 'user' })
    expect(decide('Composio')).toEqual({ allow: true, billing: 'user' })
  })
  it('requires sign-in for listed integrations', () => {
    expect(decide('google', false)).toMatchObject({ allow: false, status: 401 })
  })
  it('does not find inherited object keys', () => {
    expect(decide('constructor')).toMatchObject({ allow: false, status: 403 })
    expect(decide('__proto__')).toMatchObject({ allow: false, status: 403 })
  })
  it('the only browser-reachable integrations are google and composio', () => {
    const open = Object.entries(integrations).filter(([, c]) => !c.serverOnly).map(([n]) => n).sort()
    expect(open).toEqual(['composio', 'google'])
  })
});
