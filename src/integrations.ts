/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * Every integration requires a signed-in caller. Set `anonymous: true` on a
 * 'developer' integration to let signed-out visitors call it too — the owner
 * then pays for anyone who can reach the app.
 *
 * Browser access is DENY-BY-DEFAULT (src/server/integration-policy.ts): the
 * /api/integrations proxy refuses every integration NOT listed below, and every
 * one marked `serverOnly`. Listing an integration here is what opens it to the
 * browser, so only list ones a page genuinely needs. Server actions and jobs
 * call any integration directly and ignore this gate (they use `billing` only).
 *
 * IMPORTANT: any integration backed by per-user connected accounts (Google,
 * Composio) must be 'user' — the api-worker resolves the account from the
 * JWT subject. With 'developer' the app owner's JWT is forwarded, so every
 * signed-in user connects and acts on the app owner's account. Server code
 * that acts for a user in the background (e.g. a cron job) uses
 * `callComposio(env, ..., { asUser })` from 'deepspace/worker' instead.
 */

export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; anonymous?: boolean; serverOnly?: boolean }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  // `serverOnly` keeps the integration off the browser proxy even though it is
  // listed (it is listed so actions know its billing). Without the proxy's
  // deny-by-default, any signed-in user could spend the owner's credits here,
  // bypassing the spend ledger entirely. Server actions and jobs are unaffected.
  //
  // Generation spend. 'developer' billing means the app owner pays, which is
  // safe here because (1) these are NEVER reachable from the browser: only
  // server actions and the image job call them, and actions require a signed-in
  // caller who is a member of the room; (2) `anonymous` is left off, so the
  // generic /api/integrations proxy refuses signed-out visitors; and (3) every
  // call is reserved against the capped spend ledger first (src/server/game/budget.ts)
  // and can be switched off with GENERATION_ENABLED=false.
  anthropic: { billing: 'developer', serverOnly: true },
  fal: { billing: 'developer', serverOnly: true },
  elevenlabs: { billing: 'developer', serverOnly: true },
  // openai: { billing: 'developer', anonymous: true },
}
