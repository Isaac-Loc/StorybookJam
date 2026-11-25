/**
 * Background-job handler, invoked by AppJobRoom (worker.ts) for every queued
 * job. Dispatch on `job.type`; return a JSON-serializable result or throw.
 *
 * `generate-images` prepares pending illustrations and narration in parallel.
 * It runs as the app owner with the same RBAC-off tools the actions use. Per-page
 * ledger keys protect against duplicate spend. The queue runs one game at a time.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { createActionTools } from './server/action-routes.js'
import { generationEnabled } from './server/game/deps.js'
import { finishIfSettled, runImageJob } from './server/game/images.js'
import { runNarration } from './server/game/narration.js'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === 'generate-images') {
    const { gameId } = job.payload as { gameId?: unknown }
    if (typeof gameId !== 'string' || !gameId) throw new Error('generate-images: missing gameId')
    // No caller JWT: these integrations are developer-billed.
    const tools = createActionTools(env, env.OWNER_USER_ID, '')
    // The kill switch is re-read here, so switching generation off also stops
    // jobs that were already queued. ctx.signal lets a cancel abort in-flight calls.
    const enabled = generationEnabled(env)
    await Promise.all([
      runImageJob(tools, gameId, { enabled, signal: ctx.signal }),
      runNarration(tools, gameId, enabled, ctx.signal),
    ])
    await finishIfSettled(tools, gameId)
    return { gameId }
  }
  throw new Error(`Unknown job type: ${job.type}`)
}
