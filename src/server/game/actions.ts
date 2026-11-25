/**
 * Game server actions.
 *
 * AUTHORIZATION: these run with per-record RBAC off, so every action loads
 * the record it was pointed at and checks the caller against it. An id taken
 * from `params` is never trusted on its own:
 *   - createGame / joinGame  : any signed-in user (the caller only ever adds
 *                              THEMSELVES to a room).
 *   - setStoryTheme/startGame: caller must be the game's hostId.
 *   - submitBlank/useSafety  : caller must equal the blank's assignedTo.
 *   - tick                   : caller must have a membership row in the game.
 * submitBlank/useSafety also require a CURRENT membership, so a player who was
 * removed from the room cannot keep acting on a blank.
 *
 * Handlers are wrapped with `guarded` in src/actions/index.ts (params shape
 * check, and no uncaught throws).
 */

import {
  BLANK_COUNT,
  FILL_SECONDS,
  MAX_ACTIVE_ROOMS_GLOBAL,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_TTL_MS,
  MAX_PAGE_RETRIES,
  cleanName,
  cleanWord,
  dealBlanks,
  generateCode,
  isExpired,
  isValidCode,
  normalizeCode,
} from '../../game'
import { DEFAULT_STORY_THEME, getStoryTheme, isStoryTheme } from '../../story-themes'
import type { StoryThemeId } from '../../story-themes'
import type {
  BlankRecord,
  DraftRecord,
  GameAction,
  GameRecord,
  Loaded,
  PageRecord,
  MembershipRecord,
  Tools,
} from './helpers'
import {
  fail,
  findMembership,
  isDuplicate,
  listBlanks,
  listPages,
  listMemberships,
  loadBlank,
  loadGame,
  ok,
} from './helpers'
import { cleanupExpiredGames } from './cleanup'
import { makeDeps, generationEnabled } from './deps'
import type { GenDeps } from './deps'
import { draftStory } from './generate'
import { sweepStalePages } from './images'
import { expireGame, safetyWordFor, settle } from './reveal'
import { fixedStory } from './story'
import { isParamsObject } from './rules'
import { findGameByCode, isOverCapacity, joinRank, syncRoster } from './roster'
import { capRoster, decideCreate, isStaleClaim } from './rules'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/* ------------------------------------------------------------------ */
/* createGame                                                          */
/* ------------------------------------------------------------------ */

/**
 * Gathers the numbers for decideCreate from the games records themselves (no
 * extra collection). Returns a refusal message, or null when allowed.
 * Expired-but-not-yet-deleted rooms do not count as active, but they do still
 * count toward the creation RATE (createdAt) until they are swept.
 */
async function checkCreateLimits(tools: Tools, userId: string, now: number): Promise<string | null> {
  const mine = await tools.query<GameRecord>('games', { where: { hostId: userId }, limit: 100 })
  // Newest-expiring first: live rooms sort ahead of dead ones, so a page of
  // MAX+1 rows is enough to know whether the global ceiling is reached.
  const all = await tools.query<GameRecord>('games', {
    orderBy: 'expiresAt',
    orderDir: 'desc',
    limit: MAX_ACTIVE_ROOMS_GLOBAL + 1,
  })
  if (!mine.success || !all.success) return 'Could not create a room right now. Please try again.'

  const decision = decideCreate({
    now,
    userCreatedAt: mine.data.records.map((r) => Date.parse(r.createdAt)),
    userActiveRooms: mine.data.records.filter((r) => !isExpired(r.data, now)).length,
    globalActiveRooms: all.data.records.filter((r) => !isExpired(r.data, now)).length,
  })
  return decision.allowed ? null : decision.message
}

const EXPIRED_MESSAGE = 'This room has expired.'

export const createGame: GameAction = async ({ userId, params, tools }) => {
  const name = cleanName(params.name)
  if (!name) return fail('Pick a display name (1-20 characters).')
  const now = Date.now()

  // Opportunistic cleanup, in case the scheduled task is not firing. Bounded
  // to a few rooms and never allowed to block or fail room creation.
  await bestEffort(() => cleanupExpiredGames(tools, now, 3))

  const limit = await checkCreateLimits(tools, userId, now)
  if (limit) return fail(limit)

  // Room codes are short on purpose, so collisions are possible: uniqueOn
  // 'code' makes the DO refuse a duplicate and we simply roll a new code.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode()
    const game = await tools.create<GameRecord>('games', {
      code,
      hostId: userId,
      phase: 'lobby',
      lobbyTheme: DEFAULT_STORY_THEME,
      storyTheme: DEFAULT_STORY_THEME,
      playerIds: [userId],
      playerNames: { [userId]: name },
      phaseEndsAt: 0,
      expiresAt: now + ROOM_TTL_MS,
      filledCount: 0,
      totalBlanks: 0,
      title: '',
    })
    if (isDuplicate(game)) continue
    if (!game.success) return fail(game.error)

    const member = await tools.create<MembershipRecord>('memberships', {
      gameId: game.data.recordId,
      userId,
      name,
    })
    if (!member.success && !isDuplicate(member)) {
      await tools.remove('games', game.data.recordId) // don't leave a host-less room behind
      return fail(member.error)
    }
    return ok({ gameId: game.data.recordId, code })
  }
  return fail('Could not allocate a room code, please try again.')
}

/* ------------------------------------------------------------------ */
/* joinGame                                                            */
/* ------------------------------------------------------------------ */

export const joinGame: GameAction = async ({ userId, params, tools }) => {
  const name = cleanName(params.name)
  if (!name) return fail('Pick a display name (1-20 characters).')
  const code = normalizeCode(str(params.code))
  if (!isValidCode(code)) return fail('That is not a valid room code.')

  const game = await findGameByCode(tools, code)
  if (!game) return fail('No room with that code.')
  if (isExpired(game.data, Date.now())) return fail(EXPIRED_MESSAGE)

  // Already in? Succeed idempotently (also lets a player reopen a started game's link).
  // Re-sync first: if an earlier join created the membership but its roster
  // sync failed, this retry is what puts the player back into `playerIds`.
  if (await findMembership(tools, game.id, userId)) {
    await syncRoster(tools, game.id)
    return ok({ gameId: game.id, code })
  }
  if (game.data.phase !== 'lobby') return fail('That game has already started.')
  if ((await listMemberships(tools, game.id)).length >= MAX_PLAYERS) return fail('That room is full.')

  const created = await tools.create<MembershipRecord>('memberships', {
    gameId: game.id,
    userId,
    name,
  })
  if (!created.success && !isDuplicate(created)) return fail(created.error)
  if (!created.success) {
    // Duplicate = double-click / retry: already a member, but heal the roster too.
    await syncRoster(tools, game.id)
    return ok({ gameId: game.id, code })
  }

  // The checks above are not atomic, so several people can pass them for the
  // last seat. Re-count AFTER creating: if my membership ranks past the
  // capacity, back out. Rank is deterministic, so exactly the latecomers back out.
  const all = await listMemberships(tools, game.id)
  if (isOverCapacity(joinRank(all, created.data.recordId))) {
    await tools.remove('memberships', created.data.recordId)
    await syncRoster(tools, game.id)
    return fail('That room is full.')
  }

  // Likewise for a start that claimed the room between our phase check and our
  // insert: startGame claims (creates the storyDraft) BEFORE reading the
  // roster. If the claim is already visible, we may or may not have been dealt
  // blanks, so the safe answer is to back out.
  const claimed = await tools.query<DraftRecord>('storyDrafts', { where: { gameId: game.id }, limit: 1 })
  if (claimed.success && claimed.data.records.length > 0) {
    await tools.remove('memberships', created.data.recordId)
    await syncRoster(tools, game.id)
    return fail('That game has already started.')
  }

  if (!(await syncRoster(tools, game.id))) {
    // Membership exists, so the player is in; the denormalized list will heal on the next sync.
    console.warn(`[game] roster sync did not converge for game ${game.id}`)
  }
  return ok({ gameId: game.id, code })
}

/* ------------------------------------------------------------------ */
/* startGame                                                           */
/* ------------------------------------------------------------------ */

export const setStoryTheme: GameAction = async ({ userId, params, tools }) => {
  const game = await loadGame(tools, str(params.gameId))
  if (!game) return fail('Game not found.')
  if (game.data.hostId !== userId) return fail('Only the host can pick the story theme.')
  if (isExpired(game.data, Date.now())) return fail(EXPIRED_MESSAGE)
  if (game.data.phase !== 'lobby') return fail('The game has already started.')
  if (!isStoryTheme(params.theme)) return fail('Choose an available story theme.')

  const drafts = await tools.query<DraftRecord>('storyDrafts', { where: { gameId: game.id }, limit: 1 })
  if (!drafts.success) return fail('Could not update the story theme. Please try again.')
  const claim = drafts.data.records[0]
  if (claim && !isStaleClaim({
    phase: game.data.phase,
    blankCount: (await listBlanks(tools, game.id)).length,
    claimAgeMs: Date.now() - Date.parse(claim.createdAt),
  })) return fail('The game is already starting.')

  // Edit the lobby preview only. If a start takes the claim during the
  // update, it still writes its own locked theme with the phase transition.
  const updated = await tools.update<GameRecord>('games', game.id, { lobbyTheme: params.theme })
  return updated.success ? ok({ theme: params.theme }) : fail(updated.error)
}

/** Runs a cleanup step, swallowing any failure or thrown error. */
async function bestEffort(step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch {
    /* intentionally ignored */
  }
}

/**
 * CLAIM the start. storyDrafts is unique on gameId, so when the host
 * double-clicks (or two tabs race) exactly one create succeeds; the loser is
 * refused and bails out before touching anything else.
 *
 * A Duplicate can also be a STALE claim left by a start that died after
 * claiming (cleanup failed, worker crashed): the game is still `lobby` with no
 * blanks. Once the claim is old enough (see isStaleClaim) we delete it and
 * claim once more instead of leaving the room unstartable.
 */
async function claimStart(
  tools: Tools,
  gameId: string,
  theme: StoryThemeId,
): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const f = fixedStory(theme) // placeholder content: startGame overwrites it with the real draft
  const draft = { gameId, title: f.title, pages: f.pages, labels: f.labels, safety: f.safety, imagePrompts: f.imagePrompts, finalPrompts: [], source: f.source }
  const first = await tools.create<DraftRecord>('storyDrafts', draft)
  if (first.success) return { ok: true, draftId: first.data.recordId }
  if (!isDuplicate(first)) return { ok: false, error: first.error }

  const existing = await tools.query<DraftRecord>('storyDrafts', { where: { gameId }, limit: 1 })
  const leftover = existing.success ? existing.data.records[0] : undefined
  const current = await loadGame(tools, gameId)
  if (!leftover || !current) return { ok: false, error: 'The game has already started.' }

  const blankCount = (await listBlanks(tools, gameId)).length
  const claimAgeMs = Date.now() - Date.parse(leftover.createdAt)
  if (!isStaleClaim({ phase: current.data.phase, blankCount, claimAgeMs })) {
    const starting = current.data.phase === 'lobby' && blankCount === 0
    return {
      ok: false,
      error: starting ? 'The game is starting. Try again in a few seconds.' : 'The game has already started.',
    }
  }

  await tools.remove('storyDrafts', leftover.recordId)
  const retry = await tools.create<DraftRecord>('storyDrafts', draft)
  if (retry.success) return { ok: true, draftId: retry.data.recordId }
  return { ok: false, error: isDuplicate(retry) ? 'The game has already started.' : retry.error }
}

export const startGame: GameAction = async ({ userId, params, tools, env }) => {
  const game = await loadGame(tools, str(params.gameId))
  if (!game) return fail('Game not found.')
  if (isExpired(game.data, Date.now())) return fail(EXPIRED_MESSAGE)
  if (game.data.hostId !== userId) return fail('Only the host can start the game.')
  if (game.data.phase !== 'lobby') return fail('The game has already started.')
  if (params.theme !== undefined && !isStoryTheme(params.theme)) return fail('Choose an available story theme.')
  const theme = params.theme ?? getStoryTheme(game.data.lobbyTheme).id

  const claim = await claimStart(tools, game.id, theme)
  if (!claim.ok) return fail(claim.error)

  // Blanks THIS run created, so a failure removes only its own (never a concurrent start's).
  const createdBlankIds: string[] = []
  try {
    // Read the roster only AFTER claiming: joinGame backs out when it sees the claim.
    // Only the first MAX_PLAYERS (join order) play; anyone past that (should not
    // happen, joinGame enforces the cap) is removed from the room.
    const { players: members, overflow } = capRoster(await listMemberships(tools, game.id))
    for (const extra of overflow) await tools.remove('memberships', extra.id)
    if (members.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} player to start.`)

    // ONE model call writes this game's story (or we fall back to the fixed
    // one). It runs BEFORE any blank exists and the 75 s timer only starts in
    // the final update below, so a slow model call never eats player time.
    // The draft (templates, safety words, image prompts) stays server-side.
    const story = await draftStory(tools, game.id, game.data.hostId, generationEnabled(env), theme)
    // The model call can be slow: if our claim was meanwhile judged stale and
    // taken over by another start, our draft is gone and we must stand down
    // without touching anything that start created.
    if (!(await tools.get('storyDrafts', claim.draftId)).success) throw new Error('The game has already started.')
    const saved = await tools.update<DraftRecord>('storyDrafts', claim.draftId, {
      title: story.title,
      pages: story.pages,
      labels: story.labels,
      safety: story.safety,
      imagePrompts: story.imagePrompts,
      source: story.source,
    })
    if (!saved.success) throw new Error(saved.error)

    const playerIds = members.map((m) => m.data.userId)
    const assignments = dealBlanks(playerIds)
    const results = await Promise.all(
      assignments.map(async (a) => {
        const r = await tools.create<BlankRecord>('blanks', {
          gameId: game.id,
          idx: a.idx,
          label: story.labels[a.idx],
          value: '',
          filled: 0,
          source: '',
          assignedTo: a.assignedTo,
        })
        if (r.success) createdBlankIds.push(r.data.recordId)
        return r
      }),
    )
    const failed = results.find((r) => !r.success)
    if (failed && !failed.success) throw new Error(failed.error)

    const playerNames: Record<string, string> = {}
    for (const m of members) playerNames[m.data.userId] = m.data.name
    const go = await tools.update<GameRecord>('games', game.id, {
      phase: 'filling',
      storyTheme: theme,
      phaseEndsAt: Date.now() + FILL_SECONDS * 1000,
      totalBlanks: BLANK_COUNT,
      filledCount: 0,
      playerIds,
      playerNames,
    })
    if (!go.success) throw new Error(go.error)
    return ok({ gameId: game.id })
  } catch (e) {
    // Release the claim so the host can try again instead of being stuck.
    // Best-effort: an error inside cleanup must not mask the original error
    // (and a leftover claim is healed by claimStart's stale-claim check).
    for (const id of createdBlankIds) await bestEffort(() => tools.remove('blanks', id))
    await bestEffort(() => tools.remove('storyDrafts', claim.draftId))
    return fail(e instanceof Error ? e.message : 'Could not start the game.')
  }
}

/* ------------------------------------------------------------------ */
/* submitBlank / useSafetyWord                                         */
/* ------------------------------------------------------------------ */

type FillContext = { blank: Loaded<BlankRecord>; game: Loaded<GameRecord> }

/**
 * Shared guard for the two actions that fill one blank: the caller must own
 * the blank, the game must be in `filling`, and the timer must not have run
 * out (if it has, run the expiry path and say so).
 */
async function authorizeFill(
  tools: Tools,
  deps: GenDeps,
  userId: string,
  blankId: string,
): Promise<{ ok: true; ctx: FillContext } | { ok: false; error: string }> {
  const blank = await loadBlank(tools, blankId)
  // Same message for "missing" and "not yours" so ids can't be probed.
  if (!blank || blank.data.assignedTo !== userId) return { ok: false, error: 'That blank is not yours.' }
  const game = await loadGame(tools, blank.data.gameId)
  if (!game) return { ok: false, error: 'Game not found.' }
  if (isExpired(game.data, Date.now())) return { ok: false, error: EXPIRED_MESSAGE }
  // Being assigned a blank is not enough: the player must still be in the room.
  if (!(await findMembership(tools, game.id, userId))) return { ok: false, error: 'That blank is not yours.' }
  if (game.data.phase !== 'filling') return { ok: false, error: 'The game is not accepting words right now.' }
  if (Date.now() >= game.data.phaseEndsAt) {
    // Known and accepted: a submit that passed the checks just before the
    // deadline can overwrite a timeout word written a few ms later. Either
    // value is a valid word, so the story is unaffected.
    await expireGame(tools, game.id, deps)
    return { ok: false, error: "Time's up! Safety words were used for the empty blanks." }
  }
  if (blank.data.filled === 1) return { ok: false, error: 'That blank is already filled.' }
  return { ok: true, ctx: { blank, game } }
}

export const submitBlank: GameAction = async ({ userId, params, tools, env }) => {
  const deps = makeDeps(env, userId)
  const auth = await authorizeFill(tools, deps, userId, str(params.blankId))
  if (!auth.ok) return fail(auth.error)
  const value = cleanWord(params.value)
  if (!value) return fail('Type a word or short phrase (1-24 characters).')

  const { blank, game } = auth.ctx
  const u = await tools.update<BlankRecord>('blanks', blank.id, { value, filled: 1, source: 'player' })
  if (!u.success) return fail(u.error)
  await settle(tools, game.id, deps)
  return ok({ blankId: blank.id })
}

export const useSafetyWord: GameAction = async ({ userId, params, tools, env }) => {
  const deps = makeDeps(env, userId)
  const auth = await authorizeFill(tools, deps, userId, str(params.blankId))
  if (!auth.ok) return fail(auth.error)

  const { blank, game } = auth.ctx
  const u = await tools.update<BlankRecord>('blanks', blank.id, {
    value: await safetyWordFor(tools, game.id, blank.data.idx), // this game's own safety list
    filled: 1,
    source: 'safety',
  })
  if (!u.success) return fail(u.error)
  await settle(tools, game.id, deps)
  return ok({ blankId: blank.id })
}

/* ------------------------------------------------------------------ */
/* tick                                                                */
/* ------------------------------------------------------------------ */

/**
 * Called by every player's browser when the countdown hits zero (and every few
 * seconds afterwards). Safe to call at any time, from any number of clients:
 * it does nothing unless the game is `filling` and the deadline has passed.
 */
export const tick: GameAction = async ({ userId, params, tools, env }) => {
  const deps = makeDeps(env, userId)
  const game = await loadGame(tools, str(params.gameId))
  // Non-members get the same answer as a missing game.
  if (!game || !(await findMembership(tools, game.id, userId))) return fail('Game not found.')

  if (isExpired(game.data, Date.now())) return fail(EXPIRED_MESSAGE)
  if (game.data.phase === 'generating') {
    // Self-heal: fail pages stuck in flight so the room can never stay here forever.
    await sweepStalePages(tools, game.id, Date.now())
    return ok({ phase: (await loadGame(tools, game.id))?.data.phase ?? game.data.phase })
  }
  if (game.data.phase !== 'filling') return ok({ phase: game.data.phase })

  if (Date.now() >= game.data.phaseEndsAt) {
    await expireGame(tools, game.id, deps)
  } else if (game.data.totalBlanks > 0 && game.data.filledCount >= game.data.totalBlanks) {
    // Everything is filled but the reveal never completed (a failed write):
    // retry it rather than waiting out the clock.
    await settle(tools, game.id, deps)
  }
  const after = await loadGame(tools, game.id)
  return ok({ phase: after?.data.phase ?? game.data.phase })
}

/* ------------------------------------------------------------------ */
/* retryPage                                                           */
/* ------------------------------------------------------------------ */

/**
 * Player pressed "Retry" on a failed illustration. Caller must be a current
 * member; the page must be 'failed'; at most MAX_PAGE_RETRIES presses per page.
 * Budget is checked (and the cap enforced) by the image job, per attempt.
 */
export const retryPage: GameAction = async ({ userId, params, tools, env }) => {
  const game = await loadGame(tools, str(params.gameId))
  // Non-members get the same answer as a missing game.
  if (!game || !(await findMembership(tools, game.id, userId))) return fail('Game not found.')
  if (isExpired(game.data, Date.now())) return fail(EXPIRED_MESSAGE)
  // Only once the game has settled to `ready`. While `generating`, an earlier
  // image job may still be running, and its final cleanup (it fails any page
  // still in flight) could swallow a page we just put back to `pending`,
  // burning the retry without drawing anything.
  if (game.data.phase === 'generating') return fail('Other illustrations are still being drawn. Try again in a moment.')
  if (game.data.phase !== 'ready') return fail('There is nothing to retry yet.')

  const idx = params.idx
  const page = typeof idx === 'number' ? (await listPages(tools, game.id)).find((p) => p.data.idx === idx) : undefined
  if (!page) return fail('Page not found.')
  if (page.data.imageStatus !== 'failed') return fail('Only a failed illustration can be retried.')
  if ((page.data.retries ?? 0) >= MAX_PAGE_RETRIES) return fail('That illustration has used all of its retries.')

  const deps = makeDeps(env, userId)
  if (!deps.enabled) return fail('Illustrations are switched off right now.')

  await tools.update<PageRecord>('pages', page.id, { imageStatus: 'pending', retries: (page.data.retries ?? 0) + 1 })
  await tools.update<GameRecord>('games', game.id, { phase: 'generating' })
  try {
    await deps.enqueueImages(game.id)
  } catch {
    await tools.update<PageRecord>('pages', page.id, { imageStatus: 'failed' })
    await tools.update<GameRecord>('games', game.id, { phase: 'ready' })
    return fail('Could not start the illustration. Please try again.')
  }
  return ok({ idx: page.data.idx })
}
