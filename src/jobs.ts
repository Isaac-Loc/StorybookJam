/**
 * Background-job handler, invoked by AppJobRoom (worker.ts) for every queued
 * job. Dispatch on `job.type`; return a JSON-serializable result or throw.
 *
 * `generate-images` draws a finished story's page illustrations. It runs as
 * the app owner with the same RBAC-off tools the actions use, and only ever
 * touches pages that are still pending (see server/game/images.ts), so a
 * re-run is harmless. The job queue runs one job at a time.
 */

import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { createActionTools } from './server/action-routes.js'
import { generationEnabled } from './server/game/deps.js'
import { runImageJob } from './server/game/images.js'

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  if (job.type === 'generate-images') {
    const { gameId } = job.payload as { gameId?: unknown }
    if (typeof gameId !== 'string' || !gameId) throw new Error('generate-images: missing gameId')
    // No caller JWT: fal/anthropic are developer-billed, so the owner JWT is used.
    const tools = createActionTools(env, env.OWNER_USER_ID, '')
    // The kill switch is re-read here, so switching generation off also stops
    // jobs that were already queued. ctx.signal lets a cancel abort in-flight calls.
    await runImageJob(tools, gameId, { enabled: generationEnabled(env), signal: ctx.signal })
    return { gameId }
  }
  throw new Error(`Unknown job type: ${job.type}`)
}
