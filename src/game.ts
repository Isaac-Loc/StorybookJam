/**
 * Shared game rules for StorybookJam.
 *
 * Imported by BOTH the browser and the Worker, so it must stay free of
 * Worker-only (or DOM-only) imports. Everything here is a pure function or a
 * constant, which keeps it trivially unit-testable (see game.test.ts).
 *
 * Slice 1 uses one fixed, hand-written story with 6 blanks.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MIN_PLAYERS = 1
export const MAX_PLAYERS = 6
export const BLANK_COUNT = 6
/** How long the fill phase lasts. The server enforces it; the client only displays it. */
export const FILL_SECONDS = 75

/** A room (and its story) lives this long from creation, then becomes inaccessible and is deleted. */
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000
/** Room-creation rate limit: at most CREATE_LIMIT_PER_WINDOW rooms per user per window... */
export const CREATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
export const CREATE_LIMIT_PER_WINDOW = 5
/** ...at most this many live (non-expired) rooms hosted by one user... */
export const MAX_ACTIVE_ROOMS_PER_USER = 10
/** ...and a global ceiling so bots cannot flood storage. */
export const MAX_ACTIVE_ROOMS_GLOBAL = 300

/* ---- Generation (slice 2) ---- */

/**
 * Lifetime ceiling on ESTIMATED credits the app may spend on generation.
 * (The account has 500; the other 100 are reserved for development testing.)
 */
export const GENERATION_CAP_CREDITS = 400
/**
 * Conservative per-call estimates written to the spend ledger BEFORE a call.
 * Measured: an image bills 1.2 credits when fal reports its cost and settles,
 * but 2.0 when it does not (the $0.005 maxCostUsd ceiling x the 4x markup), so 2
 * is the true worst case. A whole game is about 8 credits.
 */
/**
 * Per-host ceiling (estimated credits, about 14 games) inside the global one,
 * so a single account cannot burn the whole budget. Rows carry the HOST's id.
 * No role can read the ledger, so the owner checks REAL spend with
 * `npx deepspace app usage --json` (the ledger holds estimates only).
 */
export const HOST_CAP_CREDITS = 120
export const COST_ESTIMATE_CREDITS = { 'llm-story': 2, 'llm-final': 3, image: 2 } as const
export type SpendKind = keyof typeof COST_ESTIMATE_CREDITS

export const LLM_MODEL = 'claude-haiku-5-5'
export const LLM_TIMEOUT_MS = 20_000
export const IMAGE_MODEL_ID = 'fal-ai/flux/schnell'
/** Hard per-image spend ceiling passed to fal (its default would reserve $2). */
export const IMAGE_MAX_COST_USD = 0.005
/**
 * 4:3 picture-book frame. A custom size, not the 'landscape_4_3' preset: the
 * preset (1024x768) made the platform estimate up to $0.006 and refuse our
 * $0.005 ceiling (measured); 768x576 is accepted and costs $0.003 (~1.2 credits).
 */
export const IMAGE_SIZE = { width: 768, height: 576 } as const
export const IMAGE_POLL_MS = 1000
export const IMAGE_TIMEOUT_MS = 60_000
/** Manual "Retry" presses allowed per page. */
export const MAX_PAGE_RETRIES = 2
/** One fixed art style for every page; the per-page prompt is appended. */
export const ART_STYLE =
  "Children's picture book illustration, soft watercolor and ink, warm friendly colors, simple shapes, no text, no letters, no words."

export const PAGE_COUNT = 4

export const IMAGE_STATUSES = ['pending', 'generating', 'ready', 'failed', 'skipped'] as const
export type ImageStatus = (typeof IMAGE_STATUSES)[number]

export const NAME_MAX_LENGTH = 20
export const WORD_MAX_LENGTH = 24

/** No 0/O, 1/I/L: codes are read aloud and typed from a phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 5

/** `lobby -> filling -> revealed` is slice 1; the rest are reserved for later slices. */
export const GAME_PHASES = ['lobby', 'filling', 'generating', 'ready', 'failed', 'revealed'] as const
export type GamePhase = (typeof GAME_PHASES)[number]

/** Where a blank's value came from. '' means still empty. */
export type BlankSource = 'player' | 'safety' | 'timeout' | ''

/* ------------------------------------------------------------------ */
/* Blank specs and the fixed story                                     */
/* ------------------------------------------------------------------ */

export type BlankSpec = {
  /** What the player is asked for. This is the ONLY thing they ever see of the story. */
  label: string
  /** Fallback words used by "Use a safety word" and by the timeout. */
  safety: readonly string[]
}

export const BLANK_SPECS: readonly BlankSpec[] = [
  { label: 'an animal', safety: ['walrus', 'llama', 'badger', 'platypus', 'goose'] },
  { label: 'a silly adjective', safety: ['wobbly', 'squishy', 'bonkers', 'fuzzy', 'soggy'] },
  { label: 'a place', safety: ['the moon', 'a swamp', 'Belgium', 'a car wash', 'the attic'] },
  { label: 'a food', safety: ['pickle', 'waffle', 'meatball', 'noodle', 'pancake'] },
  {
    label: "something you'd find in a kitchen",
    safety: ['spatula', 'toaster', 'colander', 'whisk', 'blender'],
  },
  { label: 'a sound', safety: ['boing', 'honk', 'splat', 'blorp', 'kaboom'] },
]

export const STORY_TITLE = 'Gerald and the Giant Problem'

/**
 * Four page templates. `{0}`..`{5}` are replaced with the value of the blank
 * at that index (see BLANK_SPECS). Indexes are story slots, not player slots.
 */
export const STORY_PAGES: readonly string[] = [
  'In {2}, there lived a {1} {0} named Gerald. Gerald had exactly one passion in life: {3}. He ate it for breakfast, he ate it for lunch, and once he ate it at a funeral.',
  'One morning Gerald woke up to a strange noise. In his garden sat a giant {4}, taller than a house, going "{5}! {5}!" over and over. Gerald put on his slippers and decided to be brave about it.',
  'Gerald tried to push the giant {4} away. It only grew bigger. He pulled it. It grew bigger. He yelled at it politely. It grew bigger. "Oh no," whispered Gerald, "only {3} can stop this."',
  'So Gerald fed the giant {4} a whole {3}. The {4} gave a happy shudder, floated gently into the sky and drifted away, going "{5}" all the way to the horizon. And Gerald lived happily ever after. The end.',
]

/* ------------------------------------------------------------------ */
/* Randomness                                                          */
/* ------------------------------------------------------------------ */

/**
 * Uniform random integer in [0, max) using crypto.getRandomValues, with
 * rejection sampling so there is no modulo bias.
 */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0xffffffff) {
    throw new RangeError('randomInt: max must be a positive integer <= 2^32')
  }
  const limit = Math.floor(0x1_0000_0000 / max) * max // largest multiple of max <= 2^32
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}

/** Fisher-Yates shuffle (returns a new array). */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Codes, names, words                                                 */
/* ------------------------------------------------------------------ */

export function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

/** Uppercases and strips ALL whitespace, so "ab c12" matches "ABC12". */
export function normalizeCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

/** True when the (already normalized) code could have come from generateCode. */
export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false
  return true
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Trim and collapse runs of whitespace. Whitespace is flattened FIRST so tabs
 * and newlines become plain spaces instead of being rejected as control chars.
 */
function tidy(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

/** Display name: 1-20 chars after tidying, no control characters. Null when invalid. */
export function cleanName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const name = tidy(input)
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) return null
  if (CONTROL_CHARS.test(name)) return null
  return name
}

/** Story word: same rules as a name but 1-24 chars. Null when invalid. */
export function cleanWord(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const word = tidy(input)
  if (word.length < 1 || word.length > WORD_MAX_LENGTH) return null
  if (CONTROL_CHARS.test(word)) return null
  return word
}

/* ------------------------------------------------------------------ */
/* Dealing, safety words, templates                                    */
/* ------------------------------------------------------------------ */

export type BlankAssignment = { idx: number; assignedTo: string }

/**
 * Shuffles the blanks and deals them round-robin to the players, so each
 * player gets floor(6/n) or ceil(6/n) blanks and nobody can predict which.
 * Returns one assignment per blank, sorted by idx.
 */
export function dealBlanks(playerIds: readonly string[]): BlankAssignment[] {
  if (playerIds.length === 0) throw new Error('dealBlanks: need at least one player')
  const order = shuffle(Array.from({ length: BLANK_COUNT }, (_, i) => i))
  const assignments = order.map((idx, n) => ({ idx, assignedTo: playerIds[n % playerIds.length] }))
  return assignments.sort((a, b) => a.idx - b.idx)
}

/** A random pick from a list of safety words (per-game lists come from the story draft). */
export function pickFrom(words: readonly string[]): string {
  if (words.length === 0) throw new RangeError('pickFrom: empty list')
  return words[randomInt(words.length)]
}

/** A random safety word for the blank at `blankIdx` (the built-in story's list). */
export function pickSafety(blankIdx: number): string {
  const spec = BLANK_SPECS[blankIdx]
  if (!spec) throw new RangeError(`pickSafety: no blank ${blankIdx}`)
  return spec.safety[randomInt(spec.safety.length)]
}

/** Replaces `{n}` placeholders; an unknown index is left as-is. */
export function fillTemplate(template: string, values: readonly string[]): string {
  return template.replace(/\{(\d+)\}/g, (whole, n: string) => values[Number(n)] ?? whole)
}

/**
 * Has this room's lifetime run out? A room is expired AT `expiresAt` (not one
 * ms later), matching the cleanup query. A missing/0 `expiresAt` (rooms made
 * before expiry existed) counts as expired so they get swept.
 * Every action that touches a game checks this, so an expired room is
 * unusable immediately, even before the cleanup job physically deletes it.
 */
export function isExpired(game: { expiresAt?: number }, now: number): boolean {
  return !((game.expiresAt ?? 0) > now)
}
