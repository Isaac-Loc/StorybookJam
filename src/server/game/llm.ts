/**
 * One text call to Claude through the platform integration (developer-billed,
 * see src/integrations.ts). Never throws: any failure, refusal or timeout is
 * `null`, and callers fall back to the fixed story.
 */

import { LLM_MODEL, LLM_TIMEOUT_MS } from '../../game'
import type { Tools } from './helpers'

type ChatResponse = { content?: { type?: string; text?: string }[] }

export async function askClaude(
  tools: Tools,
  system: string,
  user: string,
  maxTokens: number,
  timeoutMs: number = LLM_TIMEOUT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  try {
    const call = tools
      .integration<ChatResponse>('anthropic/chat-completion', {
        model: LLM_MODEL,
        max_tokens: maxTokens,
        temperature: 0.9,
        system,
        messages: [{ role: 'user', content: user }],
      })
      .then((r) => (r.success ? (r.data.content?.find((c) => c.type === 'text')?.text ?? null) : null))
      .catch(() => null)
    return await Promise.race([call, timeout])
  } finally {
    clearTimeout(timer)
  }
}
