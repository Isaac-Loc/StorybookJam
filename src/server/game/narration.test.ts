import { describe, expect, it } from 'vitest'
import { BLANK_COUNT, PAGE_TEXT_MAX, STORY_PAGES, WORD_MAX_LENGTH, fillTemplate } from '../../game'
import { cleanupExpiredGames } from './cleanup'
import { createFakeTools } from './fakeTools'
import { finishIfSettled } from './images'
import { getNarration, runNarration } from './narration'
import { reveal } from './reveal'
import { runAction, seedDraft, seedFilledBlanks, seedGame, seedPages } from './testSeed'

const audioUrl = 'data:audio/mpeg;base64,SUQz'

async function prepare() {
  const tools = createFakeTools()
  const gameId = await seedGame(tools, { phase: 'generating' })
  await seedPages(tools, gameId, ['ready', 'ready', 'ready', 'ready'])
  for (const row of tools.rows('pages')) {
    await tools.update('pages', row.recordId, { narrationStatus: 'pending' })
  }
  tools.onIntegration(() => ({ success: true, data: { audioUrl } }))
  return { tools, gameId }
}

describe('narrated stories', () => {
  it('keeps even the longest valid submissions within the fixed story limit', () => {
    const words = Array.from({ length: BLANK_COUNT }, (_, i) => String(i).repeat(WORD_MAX_LENGTH))
    const pages = STORY_PAGES.map((template) => fillTemplate(template, words))
    expect(pages.every((page) => page.length <= PAGE_TEXT_MAX)).toBe(true)
    for (const word of words) expect(pages.join('')).toContain(word)
  })

  it('prepares each clip once and only serves audio to room members after generation', async () => {
    const { tools, gameId } = await prepare()
    await finishIfSettled(tools, gameId)
    expect(tools.rows('games')[0].data.phase).toBe('generating')
    expect(await runAction(getNarration, 'host', tools, { gameId })).toMatchObject({ success: false })
    await runNarration(tools, gameId, true)
    await runNarration(tools, gameId, true)
    expect(tools.integrationCalls).toEqual([0, 1, 2, 3].map((idx) => ({
      endpoint: 'elevenlabs/generate-speech',
      body: { text: `page ${idx}`, model_id: 'eleven_flash_v2_5', output_format: 'mp3_22050_32' },
    })))
    expect(tools.rows('spendLedger').map((row) => row.data.credits)).toEqual([3, 3, 3, 3])
    expect(tools.rows('pages').every((row) => !('audioUrl' in row.data))).toBe(true)

    await finishIfSettled(tools, gameId)
    expect(await runAction(getNarration, 'outsider', tools, { gameId })).toMatchObject({ success: false })
    expect(await runAction(getNarration, 'p2', tools, { gameId })).toMatchObject({
      success: true,
      data: [0, 1, 2, 3].map((idx) => ({ idx, audioUrl })),
    })
    await tools.update('games', gameId, { expiresAt: Date.now() - 1 })
    expect(await runAction(getNarration, 'p2', tools, { gameId })).toMatchObject({ success: false })
    await cleanupExpiredGames(tools, Date.now(), 1)
    expect(tools.rows('narrations')).toHaveLength(0)
    expect(tools.rows('spendLedger')).toHaveLength(4)
  })

  it('queues a recovered reveal when only narration is pending', async () => {
    const { tools, gameId } = await prepare()
    await tools.update('games', gameId, { phase: 'filling' })
    await seedDraft(tools, gameId)
    await seedFilledBlanks(tools, gameId, ['otter', 'floppy', 'a barn', 'toast', 'spoon', 'zoink'])
    const queued: string[] = []
    await reveal(tools, gameId, { enabled: false, enqueueImages: async (id) => { queued.push(id) } })
    expect(tools.rows('games')[0].data.phase).toBe('generating')
    expect(queued).toEqual([gameId])
  })

  it.each(['over length', 'generation off', 'over budget'] as const)('skips narration without spending when %s', async (reason) => {
    const { tools, gameId } = await prepare()
    if (reason === 'over length') await tools.update('pages', tools.rows('pages')[0].recordId, { text: 'x'.repeat(PAGE_TEXT_MAX + 1) })
    if (reason === 'over budget') {
      await tools.create('spendLedger', { kind: 'narration', credits: 120, gameId: 'old', userId: 'host', ref: 'old' })
    }
    await runNarration(tools, gameId, reason !== 'generation off')
    await finishIfSettled(tools, gameId)
    expect(tools.integrationCalls).toHaveLength(0)
    expect(tools.rows('pages').map((row) => row.data.narrationStatus)).toEqual(Array(4).fill('skipped'))
    expect(tools.rows('games')[0].data.phase).toBe('ready')
  })
})
