/**
 * Who may call an integration through the browser-facing proxy
 * (`/api/integrations/:name/:endpoint`). Pure, so it is unit-tested.
 *
 * DENY BY DEFAULT: a developer-billed integration lets the app owner pay for
 * whoever calls it, so the browser may reach ONLY integrations that are
 * explicitly listed in src/integrations.ts and not marked `serverOnly`.
 * Everything else (openai, gemini, elevenlabs, exa, ... and anthropic/fal,
 * which are spend-capped and server-only) is refused with 403.
 * Server actions and jobs do not use this proxy and are unaffected.
 */

export type IntegrationConfig = { billing: 'developer' | 'user'; anonymous?: boolean; serverOnly?: boolean }

/** Lowercase + trim, so `Anthropic` or ` FAL ` cannot dodge a lookup keyed by lowercase names. */
export function normalizeIntegrationName(raw: string): string {
  return raw.trim().toLowerCase()
}

export type ProxyDecision =
  | { allow: true; billing: 'developer' | 'user' }
  | { allow: false; status: 401 | 403; error: string }

export function decideProxy(input: {
  /** Config looked up with the NORMALIZED name (own keys only), or undefined if unlisted. */
  config: IntegrationConfig | undefined
  signedIn: boolean
}): ProxyDecision {
  const { config } = input
  if (!config || config.serverOnly) {
    return { allow: false, status: 403, error: 'This integration is not available from the browser' }
  }
  // Developer billing would let any visitor spend the owner's credits unless
  // the app opts in with `anonymous`; user billing always needs a caller to bill.
  if (!input.signedIn && (config.billing === 'user' || !config.anonymous)) {
    return { allow: false, status: 401, error: 'Sign in required for this integration' }
  }
  return { allow: true, billing: config.billing }
}
