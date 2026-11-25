/**
 * StorybookJam slice 1 end-to-end specs.
 *
 * Needs two usable test accounts (see tests/collab.spec.ts for how to create
 * them). Rooms created here stay in the local dev database: clients cannot
 * delete game records by design, and room codes are random, so they never
 * collide with later runs.
 *
 * Not covered here: "room is full" (needs 7 signed-in accounts; the test pool
 * is capped at 10 per machine and shared with other apps). The capacity rule
 * is covered in the join action by the post-insert rank check, not by a spec.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`.',
)

const BLANK_LABELS = [
  'a small animal',
  'a made-up planet name',
  'a snack for a long trip',
  'a strange alien creature',
  'a silly space sound',
  'a funny thing to find in a rocket',
]

/** Record every text frame the server sends this page over any WebSocket. */
function captureFrames(page: Page): string[] {
  const frames: string[] = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      frames.push(typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8'))
    })
  })
  return frames
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/home')
  await page.getByTestId('display-name').fill(name)
  await page.getByTestId('create-room').click()
  // Fail with the REAL reason if the room-creation rate limit refused us (an
  // account can create 5 rooms per 10 minutes), instead of a vague timeout.
  const refusal = page.getByText(/too quickly|already host|very busy/)
  await expect(page.getByTestId('room-code').or(refusal)).toBeVisible({ timeout: 20_000 })
  if (await refusal.isVisible()) {
    throw new Error('Room creation was refused by the rate limit (wait 10 minutes after earlier runs of this account): ' + (await refusal.innerText()))
  }
  const code = (await page.getByTestId('room-code').innerText()).trim()
  expect(code).toMatch(/^[A-HJKMNP-Z2-9]{5}$/)
  return code
}

/** Opens the shared link and joins through the "Join this room" form. */
async function joinViaLink(page: Page, code: string, name: string) {
  await page.goto(`/game/${code}`)
  await expect(page.getByTestId('join-submit')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('join-name').fill(name)
  await page.getByTestId('join-submit').click()
}

async function myLabels(page: Page): Promise<string[]> {
  return page.getByTestId('blank-label').allInnerTexts()
}

/** Submit a word for every open blank card on the page, one at a time. */
async function fillAll(page: Page, prefix: string): Promise<string[]> {
  const words: string[] = []
  for (let n = 0; ; n++) {
    const input = page.getByTestId('blank-input').first()
    if (!(await input.isVisible().catch(() => false))) break
    const word = `${prefix}${n}`
    await input.fill(word)
    await page.getByTestId('blank-submit').first().click()
    await expect(page.getByTestId('blank-value').filter({ hasText: word })).toBeVisible({ timeout: 15_000 })
    words.push(word)
  }
  return words
}

test('two players: blanks stay private, then the story reveals with both words', async ({ users }) => {
  test.setTimeout(120_000)
  const [a, b] = await users(['Storybook A', 'Storybook B'])
  await b.page.setViewportSize({ width: 390, height: 844 })
  const bFrames = captureFrames(b.page)

  const code = await createRoom(a.page, 'Alice')
  await joinViaLink(b.page, code, 'Bob')

  // Live lobby for both.
  for (const p of [a.page, b.page]) {
    await expect(p.getByTestId('player-row')).toHaveCount(2, { timeout: 20_000 })
    await expect(p.getByTestId('room-code')).toHaveText(code)
  }
  await expect(a.page.getByTestId('start-game')).toBeEnabled()
  await expect(b.page.getByTestId('start-game')).toHaveCount(0) // host only
  await expect(b.page.getByRole('radio')).toHaveCount(0)
  await expect(a.page.getByRole('radio', { name: /Silly Surprise/ })).toBeChecked()
  await a.page.getByText('Tiny Quest', { exact: true }).click()
  await expect(b.page.getByTestId('selected-story-theme')).toContainText('Tiny Quest')
  await a.page.getByText('Space Trouble', { exact: true }).click()
  await expect(b.page.getByTestId('selected-story-theme')).toContainText('Space Trouble')

  await a.page.getByTestId('start-game').click()
  for (const p of [a.page, b.page]) {
    await expect(p.getByTestId('blank-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(p.getByTestId('active-story-theme')).toHaveText('Space Trouble')
    await expect(p.getByTestId('player-progress').getByRole('listitem')).toHaveCount(2)
    await expect(p.getByTestId('player-progress').locator('[data-finished="true"]')).toHaveCount(0)
  }

  // 6 blanks dealt 3 + 3, no overlap.
  const aLabels = await myLabels(a.page)
  const bLabels = await myLabels(b.page)
  expect(aLabels).toHaveLength(3)
  expect(bLabels).toHaveLength(3)
  expect([...aLabels, ...bLabels].sort()).toEqual([...BLANK_LABELS].sort())

  // B's page never shows A's labels...
  const bText = await b.page.locator('body').innerText()
  for (const label of aLabels) expect(bText).not.toContain(label)

  // A answers all of theirs; B must still see none of it, on screen or on the wire.
  const aWords = await fillAll(a.page, 'Alicezz')
  await expect(b.page.getByTestId('progress')).toContainText('3 of 6', { timeout: 20_000 })
  for (const p of [a.page, b.page]) {
    const players = p.getByTestId('player-progress').getByRole('listitem')
    await expect(players.filter({ hasText: 'Alice' })).toHaveAttribute('data-finished', 'true')
    await expect(players.filter({ hasText: 'Bob' })).toHaveAttribute('data-finished', 'false')
  }
  const bTextAfter = await b.page.locator('body').innerText()
  for (const w of aWords) expect(bTextAfter).not.toContain(w)
  const wire = bFrames.join('\n')
  expect(wire.length).toBeGreaterThan(0) // the capture itself works
  for (const label of aLabels) expect(wire).not.toContain(label)
  for (const w of aWords) expect(wire).not.toContain(w)
  // Sanity: B's own labels DO travel to B, so the assertions above are meaningful.
  for (const label of bLabels) expect(wire).toContain(label)

  // The story text and title must not travel to B before the reveal either.
  // (Distinctive bits of the title and of two different page templates.)
  const STORY_BITS = ['Crater Caper', 'Captain Pip', 'zoomed out of a crater', 'blasted off']
  for (const bit of STORY_BITS) {
    expect(wire).not.toContain(bit)
    expect(bTextAfter).not.toContain(bit)
  }

  // B finishes; the story reveals for everybody with all six words.
  const bWords = await fillAll(b.page, 'Bobzz')
  for (const p of [a.page, b.page]) {
    await expect(p.getByTestId('story-page')).toHaveCount(6, { timeout: 30_000 })
    await expect(p.getByTestId('story-title')).toHaveText(/Crater Caper/)
    await expect(p.getByTestId('active-story-theme')).toHaveText('Space Trouble')
    await expect(p.getByTestId('story-page').filter({ visible: true })).toHaveCount(1)
    const storyStage = await p.getByTestId('story-stage').boundingBox()
    expect(storyStage?.width ?? 0).toBeGreaterThan(await p.evaluate(() => innerWidth * 0.9))
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await p.evaluate(() => innerWidth))
    await expect(p.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute('aria-current', 'page')
    await p.getByRole('button', { name: 'Next' }).click()
    await expect(p.getByRole('button', { name: 'Page 2', exact: true })).toHaveAttribute('aria-current', 'page')
    await p.getByRole('button', { name: 'Previous' }).click()
    await expect(p.getByRole('button', { name: 'Page 1', exact: true })).toHaveAttribute('aria-current', 'page')
    await p.getByRole('button', { name: 'Page 6', exact: true }).click()
    await expect(p.getByTestId('story-page').filter({ visible: true })).toContainText('Page 6 of 6')
    await expect(p.getByRole('button', { name: 'Next' })).toBeDisabled()
    const story = await p.getByTestId('story-page').allInnerTexts()
    const all = story.join('\n')
    for (const w of [...aWords, ...bWords]) expect(all).toContain(w)
    expect(all).not.toMatch(/\{\d\}/)
    // Specs run with generation OFF (tests/helpers/generation-off.mjs): the fixed
    // story, and every illustration is 'skipped'. This also proves nothing is spent.
    await expect(p.getByTestId('illustration-skipped')).toHaveCount(6)
    await expect(p.getByRole('button', { name: 'Play narration' })).toHaveCount(0)
    await expect(p.getByTestId('play-again')).toBeVisible()
  }
  // Meaningfulness check: after the reveal the same text DOES reach B's socket,
  // so its absence above is real and not a broken capture.
  await expect.poll(() => bFrames.join('\n').includes('zoomed out of a crater'), { timeout: 10_000 }).toBe(true)
  expect(bFrames.join('\n')).toContain('Crater Caper')
})

// One solo room covers four things (rooms are rate limited per account, see the
// last test): a player word, a safety word, the server-side timeout fill, and
// refusing a newcomer on a started room. Waits out the real 75 second timer on
// purpose: no test-only hooks in production code.
test('solo room: player word, safety word, timeout fill, and newcomers are refused once started', async ({ users }) => {
  test.setTimeout(180_000)
  const [a, b] = await users(['Storybook A', 'Storybook B'])
  const code = await createRoom(a.page, 'Solo')
  await a.page.getByTestId('start-game').click()
  await expect(a.page.getByTestId('blank-card')).toHaveCount(6, { timeout: 20_000 })

  // One typed word and one safety word; leave four blanks for the timeout.
  await a.page.getByTestId('blank-input').first().fill('Onlyword')
  await a.page.getByTestId('blank-submit').first().click()
  await expect(a.page.getByTestId('progress')).toContainText('1 of 6', { timeout: 15_000 })
  await a.page.getByTestId('blank-safety').first().click()
  await expect(a.page.getByTestId('progress')).toContainText('2 of 6', { timeout: 15_000 })
  await expect(a.page.getByTestId('countdown')).toBeVisible()

  // While the game is running, a newcomer is refused and never shown the game...
  await joinViaLink(b.page, code, 'Late')
  await expect(b.page.getByText('That game has already started.')).toBeVisible({ timeout: 15_000 })
  await expect(b.page.getByTestId('blank-card')).toHaveCount(0)
  await expect(b.page.getByTestId('join-submit')).toBeVisible()
  // ...and a code nobody created is refused too.
  await joinViaLink(b.page, 'ZZZZZ', 'Late')
  await expect(b.page.getByText('No room with that code.')).toBeVisible({ timeout: 15_000 })

  // The timer runs out: the server fills the rest and the story reveals.
  await expect(a.page.getByTestId('story-page')).toHaveCount(6, { timeout: 100_000 })
  const story = (await a.page.getByTestId('story-page').allInnerTexts()).join('\n')
  expect(story).toContain('Onlyword')
  expect(story).not.toMatch(/\{\d\}/)
})

/*
 * Room-creation rate limit. Uses account B, which no other spec uses as a HOST
 * (B only joins rooms, and joining is not rate limited), so exhausting B's
 * quota cannot break the other specs. Robust to reruns: if B is already limited
 * when we start (a rerun inside the 10 minute window), the first click is
 * refused, which proves the same thing. If B hit the per-user cap of active
 * rooms instead (many reruns within 2 hours), that is also a friendly refusal
 * and also accepted.
 *
 * Known limitation: A hosts 2 rooms per suite run and the limit is 5 per 10
 * minutes, so the suite can be run at most twice per 10 minute window.
 */
test('creating too many rooms is refused with a friendly message', async ({ users }) => {
  test.setTimeout(120_000)
  const [b] = await users(['Storybook B'])
  await b.page.goto('/home')
  await b.page.getByTestId('display-name').fill('Spammer')

  const refusal = /too quickly|already host|very busy/
  let refused = false
  // CREATE_LIMIT_PER_WINDOW is 5, so a refusal must show up by the 6th attempt.
  for (let attempt = 1; attempt <= 7 && !refused; attempt++) {
    await b.page.getByTestId('create-room').click()
    const toast = b.page.getByText(refusal)
    const lobby = b.page.getByTestId('room-code')
    await expect(toast.or(lobby)).toBeVisible({ timeout: 20_000 })
    if (await toast.isVisible()) {
      refused = true
    } else {
      await b.page.goto('/home') // created a room; back to the form for the next one
      await b.page.getByTestId('display-name').fill('Spammer')
    }
  }
  expect(refused, 'the server never refused room creation').toBe(true)
  // Still on the home page: no room was created by the refused attempt.
  await expect(b.page.getByTestId('create-room')).toBeVisible()
})
