/**
 * The two model calls: drafting the story at Start, and the polish + safety
 * rewrite at reveal. Both reserve budget first, validate strictly, and return
 * `null`/the fixed story on ANY problem, so the game always works.
 */

import { askClaude } from './llm'
import { reserveSpend } from './budget'
import type { Tools } from './helpers'
import { DEFAULT_STORY_THEME } from '../../story-themes'
import type { StoryThemeId } from '../../story-themes'
import type { PolishedPage, StoryDraft } from './story'
import {
  POLISH_SYSTEM,
  STORY_SYSTEM,
  fixedStory,
  parseModelJson,
  polishUserPrompt,
  storyUserPrompt,
  leaksReplacedWord,
  validatePolished,
  validateStory,
} from './story'

/**
 * Output budget per call. Haiku 5.5 spends some of max_tokens on (hidden)
 * reasoning before it writes the JSON, and a 1800 limit was measured to cut
 * the story off mid-JSON (stop_reason max_tokens). Generous but bounded.
 */
const STORY_MAX_TOKENS = 4000
const POLISH_MAX_TOKENS = 4000

/**
 * ONE model call to write this game's story. Falls back to the fixed story
 * when generation is off, over budget, or the output fails validation.
 * The reservation is kept even when the call fails: it may have been billed.
 */
export async function draftStory(
  tools: Tools,
  gameId: string,
  hostId: string,
  enabled: boolean,
  theme: StoryThemeId = DEFAULT_STORY_THEME,
): Promise<StoryDraft> {
  if (!enabled) return fixedStory(theme)
  if ((await reserveSpend(tools, 'llm-story', gameId, 'story', hostId)) !== 'ok') return fixedStory(theme)
  const text = await askClaude(tools, STORY_SYSTEM, storyUserPrompt(theme), STORY_MAX_TOKENS)
  return validateStory(parseModelJson(text)) ?? fixedStory(theme)
}

/**
 * Substitutes the player words into the templates and moderates them, in one
 * call. The words are sent only as delimited untrusted data. Returns null when
 * the caller must fall back to plain text with NO illustrations.
 * (The budget reservation for this call is made by the caller, so that it can
 * double as the once-per-game claim; see reveal.ts.)
 */
export async function polishStory(
  tools: Tools,
  draft: Pick<StoryDraft, 'pages' | 'imagePrompts'>,
  words: readonly string[],
): Promise<PolishedPage[] | null> {
  const text = await askClaude(tools, POLISH_SYSTEM, polishUserPrompt(draft, words), POLISH_MAX_TOKENS)
  const pages = validatePolished(parseModelJson(text))?.pages ?? null
  // A word replaced in the text but still in an image prompt must never reach fal.
  return pages && !leaksReplacedWord(pages, words) ? pages : null
}
