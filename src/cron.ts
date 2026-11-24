/**
 * Scheduled tasks, run by the AppCronRoom Durable Object (see worker.ts).
 *
 * Platform granularity: a task declares `intervalMinutes` (integer 1..10080)
 * or a 5-field cron `schedule`; the finest supported interval is 1 minute.
 * We use 15 minutes: expiry is enforced instantly by the actions, so cleanup
 * only reclaims storage and does not need to be prompt.
 *
 * Record access: `buildCronContext` has no `deleteWhere`, so we build the same
 * RBAC-bypassing tools the action routes use (createActionTools), acting as
 * the app owner. No integrations are called, so no caller JWT is needed.
 */

import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { createActionTools } from './server/action-routes.js'
import { cleanupExpiredGames } from './server/game/cleanup.js'

export const CLEANUP_TASK = 'cleanup-expired-rooms'
/** Max rooms deleted per run; the next run (15 min later) continues any backlog. */
const CLEANUP_BATCH = 25

export const tasks: CronTask[] = [{ name: CLEANUP_TASK, intervalMinutes: 15 }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== CLEANUP_TASK) return
  const tools = createActionTools(env, env.OWNER_USER_ID, '')
  const { roomsDeleted } = await cleanupExpiredGames(tools, Date.now(), CLEANUP_BATCH)
  console.info(`[cron] ${CLEANUP_TASK} deleted ${roomsDeleted} expired room(s)`)
}
