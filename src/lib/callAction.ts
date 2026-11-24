/**
 * Tiny typed client for the Worker's server actions (POST /api/actions/<name>).
 *
 * Never throws: network problems, 401s and non-JSON error pages all come back
 * as `{ success: false, error }` so callers can toast the message.
 */

import { getAuthToken } from 'deepspace'

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string }

export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResponse<T>> {
  try {
    const token = await getAuthToken()
    if (!token) return { success: false, error: 'You are signed out. Please sign in again.' }

    const res = await fetch(`/api/actions/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    if (res.status === 401) return { success: false, error: 'Your session expired. Please sign in again.' }

    let body: unknown
    try {
      body = await res.json()
    } catch {
      // HTML/text error page from a proxy or a crashed Worker.
      return { success: false, error: `Server error (${res.status}). Please try again.` }
    }

    const b = body as { success?: boolean; data?: T; error?: string }
    if (b.success === true) return { success: true, data: b.data as T }
    return { success: false, error: b.error ?? `Request failed (${res.status}).` }
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}
