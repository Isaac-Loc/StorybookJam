import { isExpired, storyPageCount, storyPageTextMax } from '../../game'
import { reserveSpend } from './budget'
import { fail, findMembership, listPages, loadGame, ok } from './helpers'
import type { GameAction, Loaded, NarrationRecord, PageRecord, Tools } from './helpers'

const NARRATION_TIMEOUT_MS = 20_000
// Short 32 kbps MP3s fit comfortably. Bound provider output before storing
// or forwarding it, including the overhead of base64 and the data URL.
const MAX_AUDIO_URL_LENGTH = 128 * 1024
const MP3_DATA_URL = /^data:audio\/(?:mpeg|mp3);base64,[A-Za-z0-9+/]+={0,2}$/

function isAudioUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length <= MAX_AUDIO_URL_LENGTH && MP3_DATA_URL.test(url)
}

async function synthesize(tools: Tools, text: string, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  const deadline = new Promise<null>((resolve) => {
    abort = () => resolve(null)
    timer = setTimeout(abort, NARRATION_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
  })
  try {
    const result = await Promise.race([
      deadline,
      tools.integration<{ audioUrl?: unknown }>('elevenlabs/generate-speech', {
        text,
        model_id: 'eleven_flash_v2_5',
        output_format: 'mp3_22050_32',
      }),
    ])
    return result?.success && isAudioUrl(result.data.audioUrl) ? result.data.audioUrl : null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

async function narratePage(
  tools: Tools,
  page: Loaded<PageRecord>,
  hostId: string,
  expiresAt: number,
  textMax: number,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const { gameId, idx, text } = page.data
  let status: PageRecord['narrationStatus'] = 'skipped'
  if (enabled && !signal?.aborted && expiresAt > Date.now() && text.length > 0 && text.length <= textMax) {
    const reservation = await reserveSpend(tools, 'narration', gameId, `p${idx}`, hostId)
    if (reservation === 'ok') {
      status = 'failed'
      const audioUrl = expiresAt > Date.now() ? await synthesize(tools, text, signal) : null
      if (audioUrl && expiresAt > Date.now()) {
        const saved = await tools.create<NarrationRecord>('narrations', { gameId, idx, audioUrl })
        if (saved.success) status = 'ready'
      }
    } else if (reservation === 'duplicate') {
      // A previous run may have saved the clip before failing to publish its
      // status. Recover it without making a second paid call.
      const saved = await tools.query<NarrationRecord>('narrations', { where: { gameId, idx }, limit: 1 })
      status = saved.success && isAudioUrl(saved.data.records[0]?.data.audioUrl) ? 'ready' : 'failed'
    }
  }
  await tools.update<PageRecord>('pages', page.id, { narrationStatus: status })
}

export async function runNarration(
  tools: Tools,
  gameId: string,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const game = await loadGame(tools, gameId)
  if (!game) return
  const pages = await listPages(tools, gameId)
  const pageCount = storyPageCount(game.data.pageCount)
  const textMax = storyPageTextMax(pageCount)
  // The reveal only leaves narration pending after the safety pass. All
  // pages must fit the cap before we pay for any of them.
  const canNarrate = enabled && pages.length === pageCount &&
    pages.every(({ data }) => data.text.length > 0 && data.text.length <= textMax)
  await Promise.allSettled(
    pages.filter(({ data }) => data.narrationStatus === 'pending').map(async (page) => {
      try {
        await narratePage(tools, page, game.data.hostId, game.data.expiresAt, textMax, canNarrate, signal)
      } catch {
        await tools.update<PageRecord>('pages', page.id, { narrationStatus: 'failed' })
      }
    }),
  )
}

/** Return completed clips only to a current, unexpired room member. No paid API call. */
export const getNarration: GameAction = async ({ userId, params, tools }) => {
  const game = typeof params.gameId === 'string' ? await loadGame(tools, params.gameId) : null
  if (!game || !game.data.playerIds.includes(userId) || !(await findMembership(tools, game.id, userId))) {
    return fail('Game not found.')
  }
  if (isExpired(game.data, Date.now())) return fail('This room has expired.')
  if (game.data.phase !== 'ready') return fail('The story is still being prepared.')
  const result = await tools.query<NarrationRecord>('narrations', { where: { gameId: game.id }, limit: storyPageCount(game.data.pageCount) })
  if (!result.success) return fail('Could not load the narration.')
  return ok(result.data.records.flatMap(({ data: { idx, audioUrl } }) =>
    isAudioUrl(audioUrl) ? [{ idx, audioUrl }] : [],
  ))
}
