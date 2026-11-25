/**
 * Environment-derived switches and the one place that talks to the job queue.
 */

import { enqueueJob } from 'deepspace/worker'

/** The slice of the Worker env the game actions need. */
export type GameEnv = {
  /** Set to "false" in the app secrets store to switch ALL generation off. */
  GENERATION_ENABLED?: string
  DEEPSPACE_APP_ID: string
  JOB_ROOMS: DurableObjectNamespace
}

/**
 * Kill switch. Default is ON: only the explicit string "false" turns
 * generation off (story and polish calls and images all fall back to the
 * fixed story with images 'skipped').
 */
export function generationEnabled(env: Pick<GameEnv, 'GENERATION_ENABLED'>): boolean {
  return env.GENERATION_ENABLED?.trim().toLowerCase() !== 'false'
}

/** What reveal/retryPage need from the outside world; faked in unit tests. */
export type GenDeps = {
  enabled: boolean
  /** Queue the image job for a game (only pending pages are touched). */
  enqueueImages: (gameId: string) => Promise<void>
}

export function makeDeps(env: GameEnv, userId: string): GenDeps {
  return {
    enabled: generationEnabled(env),
    enqueueImages: async (gameId) => {
      // maxAttempts 2: if the handler dies, the platform runs it once more.
      // That is safe: every fal attempt has a unique ledger key, so a dead
      // run's attempt is a Duplicate on re-run (no second call, no double
      // spend) and its page just becomes 'failed' and retryable (images.ts).
      await enqueueJob(env.JOB_ROOMS, `app:${env.DEEPSPACE_APP_ID}`, 'generate-images', { gameId }, {
        maxAttempts: 2,
        enqueuedBy: userId,
      })
    },
  }
}
