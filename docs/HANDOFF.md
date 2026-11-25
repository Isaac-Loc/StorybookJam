# StorybookJam: handoff and spec

Everything an agent (or human) needs to pick this repo up cold. Read this, then
`AGENTS.md` (the DeepSpace platform workflow). Keep this file current: when you
change behavior, limits or decisions, update the relevant section.

- Live app: https://storybookjam.app.space
- Repo: https://github.com/Isaac-Loc/StorybookJam (public, default branch `dev`)
- Stack: DeepSpace SDK (Cloudflare Workers + Durable Objects), React + Vite,
  Tailwind v4, vitest, Playwright via `deepspace test`.
- Context: built as a one-day "ship something small" build exercise on
  DeepSpace. Deadline was 2026-11-24 23:59 ET. The submission is the live URL,
  the repo and a short written note (see "Writeup" below).

## 0. Resume here (state snapshot, 2026-11-24 ET)

The last verified live release and GitHub `dev` head were at `4414442`, with
six-page rounds and bundled sample narration. This checkout lengthens the
pages, moves the tone toward deadpan comedy for friend groups, and gives
the finished story a viewport-sized reader. Verify deployment by comparing
`npx deepspace releases` with `git rev-parse --short HEAD`. Sample narration
and its one-time charge are verified. The longer rounds are unverified live.

First five minutes in a new session (read-only, free):
```bash
git status && git log --oneline -5
npx deepspace releases          # latest release = last DEPLOYED commit (docs-only commits may be ahead on origin/dev)
npx deepspace app usage --json  # credits used / remaining (100 credits = US$1)
npm run type-check && npm run lint && npm run test:unit && npm run build
```
If a command needs the DeepSpace login and fails, the developer's session lives
at `~/.deepspace/session` (it acts as the developer; never print or copy it).
Ask the developer to run it or to approve it rather than working around it.

Next actions, in order (see section 3 for the table):
1. DONE: landing sample book. `public/sample/page-1..4.jpg` plus a static
   section in `src/pages/index.tsx` (hand-written story "Pip and the Giant
   Spatula", pictures made with the same fal model, size and style as the app;
   the landing page itself never calls a model). The four images cost about 5.6
   credits, and one page was regenerated (about 1.4 more).
2. DONE: `README.md` rewritten with the real features, caps and kill switch.
3. DONE (draft): `docs/SUBMISSION_NOTE.md`. The developer must read it, edit it
   into their own voice, resolve the `[CONFIRM]` lines, and paste it into the
   portal. Re-check any number before changing it.
4. **Final live check.** Get explicit approval before committing, pushing,
   deploying, or making a paid provider call. Play one full round to verify
   theme-specific generation, checkmarks, page order, autoplay fallback, and
   actual cost. Confirm that the latest
   release commit in `npx deepspace releases` is the latest commit that changed
   app code (`git log` shows which later commits are docs-only), and that GitHub
   `dev` contains it. Before submitting, ideally deploy the final commit so the
   live app and the repo head match exactly.
5. **Clean up test accounts** (ask first):
   `npx deepspace test accounts delete --email storybook-a@deepspace.test` and
   the same for `storybook-b@deepspace.test`. Do this last, after the final
   e2e run.
6. **Submit in the portal:** live URL, repository URL, the note.

Environment notes for other agent tools (for example Codex): the shell is
Windows PowerShell. Use `git commit -F <file>` (see section 5). Network and
`npx deepspace` calls may need approval in a sandbox. Claude-specific tools are
not required for anything in this repo.

## 1. What the product is

A multiplayer Mad-Libs picture book. A signed-in host creates a room (5-letter
code). Up to 6 players join. The host picks a story theme in the lobby.
A language model writes a six-page story in that theme with 6 blanks; each
blank is secretly dealt to a player, who sees only that
blank's label ("an animal") and never the story. A 75-second timer runs; a
player can tap "Use a safety word" and the server fills anything left when time
runs out. A checkmark shows when a player has filled all their own blanks.
When every blank is filled, a second model call rewrites harmful player words,
then an illustration and narration clip are generated for each page. The book
attempts playback when ready and turns a page when its clip ends. Rooms expire
after 2 hours and are deleted. There are no public books.

Why it exists as a design: the interesting technical part is that the hidden
data is hidden by the SERVER (record permissions), not by the UI. A player's
browser never receives other players' blanks, the story template or the image
prompts. Preserve that property in every change.

## 2. Decisions already made (do not reverse without asking the user)

| Decision | Value |
|---|---|
| Sign-in | Required for everyone. Anonymous DeepSpace connections have no stable identity and cannot call actions, so guest play was rejected. Custom guest tokens were considered and rejected (time, and it reimplements platform features) |
| Players | 1 to 6; solo allowed; always 6 blanks, shuffled and dealt round-robin |
| Timer | 75 s fill phase, enforced by the server; clients only display it |
| Safety words | Per-blank safety words from the story draft; used on tap or when the timer expires |
| Reveal | Automatic when the last blank is filled. The slideshow tries autoplay and offers manual play and page controls |
| Tone / art | Deadpan absurdity and genre parody for friend groups, with the existing all-ages safety pass. The host chooses Silly Surprise (editorial watercolor), Space Trouble (retro sci-fi pulp), or Tiny Quest (cut-paper adventure). The theme guides the story, blank prompts, illustration style, and reader accents. |
| Length | New rounds have 6 pages, at most 200 characters per page and 1,200 across the page bodies. The prompt asks for connected scenes and an ending that pays off the setup. Existing 4-page rounds can finish with their original 150-character page limit. |
| Sharing | No public player books. The landing page has a four-page sample book (`public/sample/`) and a bundled recording (`src/assets/sample-narration.mp3`). Playing it makes no integration calls. |
| Room lifetime | 2 hours, then deleted (cron + opportunistic cleanup) |
| Spend | Generation is developer-billed. App-side cap 400 estimated credits globally, 120 per host; 100 credits kept for development testing |
| Integrations | `anthropic`, `fal`, and `elevenlabs`. No video (fal compute-priced runs reserve $2) |

## 3. Status

Done and live (release history from `npx deepspace releases`):

| Release | Commit | What |
|---|---|---|
| #1 | 95a7000 | Scaffold hello-world |
| #2 | a299c84 | Slice 1: rooms, join codes, hidden blanks, timer, safety words, fixed story; room-creation rate limits; 2-hour expiry + cleanup |
| #3 | e322803 | Fix: the app owner is auto-`admin`; admin must be able to read their OWN blanks |
| #4 | 9b21f66 | Slice 2: model-written story, safety rewrite, 4 illustrations, spend ledger and caps, kill switch, deny-by-default integration proxy |
| #5 | e9fd4d7 | Landing page sample book, rewritten README, submission-note draft |
| later | docs only | Handoff corrections, each redeployed so the live app matches the repo head |
| later | 7b36c0e | Narrated slideshow and player completion checkmarks |
| later | b2f8e77 | Redesigned frontend and host-selected story themes |
| later | 4414442 | Six-page stories and bundled sample narration |

This checkout adds longer, more connected pages and the larger finished-book
reader. Use `npx deepspace releases` to verify the currently live commit.

Remaining, in priority order:
1. The developer reviews `docs/SUBMISSION_NOTE.md` and resolves its `[CONFIRM]` lines.
2. One last live round by the developer; read real cost with
   `npx deepspace app usage --json` and update the note's numbers if needed.
3. Delete the two test accounts at the very end (ask the user first).
4. Submit in the portal (live URL, repo URL, note).
5. Optional hardening listed in "Known gaps".

## 4. Architecture

### Collections (single app room `app:<APP_ID>`, schemas in `src/schemas/game-schemas.ts`)

All writes go through server actions; no client role has create/update/delete
on any game collection (admin may delete `games`, `memberships` and `pages`).

| Collection | Holds | Who can read |
|---|---|---|
| `games` | code, hostId, phase, lobbyTheme, storyTheme, playerIds, playerNames, phaseEndsAt, expiresAt, filledCount, finishedPlayerIds, totalBlanks, pageCount, title | members who are in `playerIds` (`read: 'shared'`), admin all |
| `memberships` | gameId, userId, name (the authoritative roster; unique per game+user) | own row; admin all |
| `blanks` | label, value, filled, source, assignedTo | ONLY the assignee (`ownerField: assignedTo`, `read: 'own'` for member AND admin) |
| `storyDrafts` | drafted template, safety words, image prompts, `finalPrompts` | NO role (server only). Its `uniqueOn gameId` doubles as the "start claimed" lock |
| `pages` | gameId, idx, text, imageUrl, imageStatus, retries, narrationStatus, playerIds | players (`shared`), admin all |
| `narrations` | gameId, idx, audioUrl (bounded MP3 data URL, unique per game and page) | no client role. Current room members can retrieve finished clips through `getNarration` |
| `spendLedger` | append-only spend reservations (gameId, kind, ref, credits, userId) | NO role. NOT deleted by room cleanup |

### Server actions (`src/server/game/actions.ts`, wired in `src/actions/index.ts`)

`createGame`, `joinGame`, `setStoryTheme`, `startGame`, `submitBlank`, `useSafetyWord`, `tick`,
`retryPage`, `getNarration`. Every action loads the record it was pointed at and checks the
caller against it, because action tools run with RBAC OFF
(see the comment at the top of `src/server/action-routes.ts`).

Game phases: `lobby -> filling -> generating -> ready`; `failed` and the
legacy slice-1 `revealed` are declared; read `src/server/game/reveal.ts` for the
exact transitions.

### Flow

1. `createGame`: rate limits (5 per 10 min, 10 active rooms per user, 300
   globally), opportunistic cleanup of up to 3 expired rooms, unique code
   (uniqueOn `code`, retry on Duplicate), membership row.
2. `joinGame`: idempotent; membership create is unique per game+user; re-count
   and rank by join order to back out over capacity; `syncRoster` rebuilds
   `playerIds` from memberships with read-back (prevents lost updates).
3. `setStoryTheme`: validates a preset ID and lets only the host of an open,
   unexpired lobby change `lobbyTheme`. Everyone in the lobby sees it.
   `startGame` is host-only and claims the room by creating the `storyDrafts`
   row. It accepts the host's explicit choice, or uses the saved lobby
   selection. Missing theme fields fall back to Silly Surprise. One Claude
   call drafts the story from trusted theme instructions, with a matching fixed
   story on failure, over budget, or when generation is off. It creates 6
   blanks and writes `storyTheme` and `pageCount` with the transition to filling. Late lobby
   writes cannot change that locked theme. The timer starts after blanks exist.
   Stale-claim recovery runs after 60 s.
4. `submitBlank` / `useSafetyWord`: caller must own the blank and be a current
   member; phase must be `filling`. A late call runs the expiry path. The server
   recount publishes which players filled every assigned blank. Chosen safety
   words count as submitted. Server timeout fills do not count. Labels and
   answers remain private.
5. `tick`: any member's browser calls it when the countdown hits 0 (and while
   generating, every 30 s). Idempotent: fills empty blanks with safety words
   after the deadline, retries a failed reveal, sweeps stuck pages.
6. Reveal (`reveal.ts`): the `llm-final` ledger row is unique per game so one
   concurrent trigger makes the paid "polish and safety" call; player words go
   in as UNTRUSTED data; output validated; page rows created idempotently;
   image prompts live only in `storyDrafts.finalPrompts`; then the image job is
   enqueued. If the polish call fails or the cap is hit, pages are text-only
   and images and narration are `skipped`. Only polished output goes to fal
   and ElevenLabs. Draft templates must fit after the longest valid
   substitutions, and polished pages are also length checked. The draft's
   length lets an in-progress four-page round finish with its original size.
7. Media job `generate-images` (`src/jobs.ts`, `src/server/game/images.ts`,
   `AppJobRoom` in `worker.ts`): per page `fal/run-model` then poll
   `fal/get-result`; one auto-retry; deadlines and abort handling; marks pages
   `failed`/`skipped`; `maxAttempts: 2` (a re-run hits the duplicate ledger key,
   so no double spend). `retryPage` allows manual retries (max 2 per page) only
   when the game is `ready`. In parallel, the job requests one low bitrate MP3
   per page from ElevenLabs, with a unique spend reservation and no paid
   retries. Illustrations use the locked theme's art direction with the existing
   moderated prompts. Theme selection adds no integration calls or spend.
   The game becomes ready once both kinds of media have settled.
8. `getNarration` checks current membership, room expiry, and the ready phase
   before returning stored clips. The slideshow tries to play page one,
   advances on audio end, and holds a page with unavailable audio for a short
   reading delay if the story has other clips. A story with no clips only
   advances manually. The reader uses most of the viewport and keeps page
   controls grouped with playback. Players can pause, resume, or turn pages.
   Pausing or replaying does not bill.

### Cleanup and cron

`src/cron.ts` task `cleanup-expired-rooms` every 15 minutes calls
`cleanupExpiredGames` (`src/server/game/cleanup.ts`), which deletes expired
rooms and their `memberships`, `blanks`, `storyDrafts`, `pages`, and `narrations`. Every action
also refuses an expired room immediately. Verify with
`npx deepspace logs --search cron`.

### Integrations and cost

| Integration | Use | Notes |
|---|---|---|
| `anthropic/chat-completion` | story draft; polish and safety rewrite | model `claude-haiku-5-5`, `max_tokens` 4000 (the model spends output tokens on hidden reasoning; 1800 truncated the JSON), response has a `thinking` block first, parser takes the `text` block, 20 s timeout |
| `fal/run-model`, `fal/get-result` | page images | `fal-ai/flux/schnell`, size 768x576 (the `landscape_4_3` preset made the platform estimate exceed the cap), ALWAYS `maxCostUsd: 0.005` |
| `elevenlabs/generate-speech` | one MP3 clip per page | DeepSpace catalog lists US$0.0002/character on the free tier. Uses `eleven_flash_v2_5` and `mp3_22050_32` |

Cost facts (100 credits = US$1; account is on the free tier with a 500-credit
allowance): one image is billed up to 2.0 credits (0.005 x ~4x platform markup;
fal itself reports ~$0.003); a prior game without narration was roughly 5 to 8
credits. Narration adds an estimated maximum of 4 credits per 200-character
page and 24 per six-page story. Each request contains just that page's body,
with no title or separator. With the two story calls and first attempts at all
illustrations and clips, the ledger reserves 41 credits for a six-page round.
Retries may add image costs. A live longer round has not been measured. The sample's
543-character combined recording cost 10.86 credits once. Serving the saved
MP3 does not call ElevenLabs. The ledger
estimates are `COST_ESTIMATE_CREDITS` in `src/game.ts`. The ledger is
race-free: write the reservation row first, sum, delete your own row if over
the cap. Real spend: `npx deepspace app usage --json`.

Kill switch: `GENERATION_ENABLED` env var, only the string `false` turns
generation off (production default is ON). To switch off in production:
`npx deepspace secrets set GENERATION_ENABLED=false` then redeploy.

Integration proxy: `src/server/http-routes.ts` + `src/server/integration-policy.ts`
are DENY-BY-DEFAULT for browser calls (only `google` and `composio` are
reachable; `anthropic`, `fal`, and `elevenlabs` are `serverOnly`). Without this, any signed-in user
could spend the owner's credits. Do not loosen it.

### File map

```
src/game.ts                    shared constants, fixed story, pure helpers
src/story-themes.ts             preset names, settings, and art direction
src/jam.css                     site styles and story world accents
src/schemas/game-schemas.ts    collections + permissions (and its tests)
src/actions/index.ts           action registry (guarded wrappers)
src/server/game/               actions, roster, reveal, images, narration, generate, story,
                               llm, budget, cleanup, rules, deps (kill switch),
                               fakeTools + testSeed (test support only)
src/server/integration-policy.ts, http-routes.ts   deny-by-default proxy
src/jobs.ts, worker.ts, src/cron.ts                job + cron wiring
src/pages/(app)/(protected)/home.tsx, game/[code].tsx   client pages
src/components/game/           Lobby, JoinRoom, Filling, Revealed
tests/game.spec.ts             two-account Playwright spec
tests/helpers/generation-off.mjs   turns generation off for e2e
public/sample/page-1..4.jpg    landing-page sample illustrations (committed assets)
src/assets/sample-narration.mp3  bundled landing-page sample recording
docs/SUBMISSION_NOTE.md        draft of the portal writeup (developer edits it)
```

## 5. Hard-won platform lessons

- The app OWNER is automatically role `admin`, and the owner plays too. A rule
  like `admin read: false` on `blanks` made the owner see "no blanks". Every
  permission rule must be checked for the owner-as-player case. A unit test
  evaluates each role with the SDK's real `canRead`.
- Action tools bypass RBAC; authorize inside every action.
- `uniqueOn` violations are refusals on the write ack (`success: false`,
  message starts with `Duplicate:`), not exceptions; the code relies on them for
  locks (start claim, reveal claim, ledger rows, page rows).
- JSON columns come back already parsed. Record fields live under `.data`.
- Schemas are baked at deploy time. New collections need a deploy.
- `fal/run-model` returns `{ jobId }`; `fal/get-result` takes it as
  `request_id`. Never omit `maxCostUsd`: the default reserve ($2 x markup) is
  larger than the whole balance.
- Paid jobs must be admin-only on the job socket (`authorizeWrite` in
  `worker.ts`); actions enqueue through the worker-side `enqueueJob`, which
  bypasses that check.
- `.dev.vars` is generated by the CLI and git-ignored; do not hand-edit it.
- Windows/PowerShell: passing a multi-line commit message containing double
  quotes to `git commit -m` breaks. Write the message to a file and use
  `git commit -F <file>`.
- Deploy needs a clean, committed tree. `npx deepspace deploy` ships the LOCAL
  commit; pushing to GitHub does not deploy. Workflow: commit, deploy, push,
  then confirm with `npx deepspace releases` that the latest release commit
  is the latest commit that changed app code and that GitHub contains it
  (docs-only commits can legitimately sit ahead of the deployed release).

## 6. Testing

- `npm run type-check`, `npm run lint`, `npm run test:unit`, and
  `npm run build`. Run all four before any commit.
- Unit tests use an in-memory fake of the action tools with scriptable
  integrations (`src/server/game/fakeTools.ts`), so no paid calls.
- E2E: `npx deepspace test run tests/game.spec.ts` (about 1.5 minutes). Uses two
  `@deepspace.test` accounts from the developer's pool
  (`npx deepspace test accounts list`; credentials live in
  `~/.deepspace/test-accounts.json`; NEVER print or commit them). It proves
  hidden blanks on the wire (player B's WebSocket frames and page never contain
  player A's blanks or the story before the reveal).
- E2E runs with generation OFF: the start command runs
  `tests/helpers/generation-off.mjs`, which appends `GENERATION_ENABLED=false`
  to the generated `.dev.vars` (skipped when `STORYBOOK_REAL_GENERATION=1`, which
  spends real credits). The spec checks skipped illustrations, no narration
  control, shared player checkmarks, and manual slideshow navigation. The
  two-player case also checks that only the host can choose a theme, the other
  player sees the lobby changes, and both get the locked theme at reveal.
- E2E limits: room creation is rate limited (5 per 10 min per user, 10 active
  rooms per user, rooms live 2 h), so a test account supports about 5 runs per
  2 hours. If a run fails at room creation, check for the refusal text before
  assuming a bug. Local dev state lives in `.wrangler/` (git-ignored).
- Not covered by automated tests: the 7th-player "room full" path, true
  concurrent joins, the join Retry button, crash recovery inside the Durable
  Object, a real failed image plus manual Retry, admin-only `authorizeWrite`.

## 7. Working agreements for agents

- Do not commit, push or deploy unless the user asks. Do not make paid calls
  (anthropic, fal, anything) without asking; development testing budget is
  about 100 credits total.
- The repo is PUBLIC: no secrets, tokens, `.dev.vars`, session files, test
  passwords, personal emails or account IDs in any committed file.
- Prefer platform primitives (records, permissions, actions, jobs, cron,
  secrets) over reimplementing them. If you add an integration, set its
  billing and `serverOnly` deliberately in `src/integrations.ts`.
- The process used so far: one agent implements, a second independent
  read-only agent reviews, fixes are re-checked, then the lead verifies the
  checks itself before committing. The review found real blockers each time;
  keep doing it for risky changes.
- Never trust a subagent's report on its own: re-run type-check, lint, unit
  tests and build.

## 8. Rejected alternatives (useful for the writeup)

- Music as the product (shared playlists/quizzes): Deezer (terms: widget-only
  playback, no local copies, no games, approval required), iTunes Search (previews
  only to promote store content, not for entertainment), Spotify (developer
  policy bans games; dev mode capped at 5 users and needs Premium), YouTube
  (ads, search credits), Audius/Internet Archive (open but no mainstream
  catalog). None gave free, ad-free, rule-clean mainstream audio, so the project
  became a word game with generated illustrations.
- Gemini for images: free-tier pricing made a 4-page book about 10x more
  expensive than fal FLUX schnell.
- Video generation (fal compute-priced $2 reserve, Shotstack per-second).
- Cloudflare Turnstile / dashboard rate limiting: the app lives on a platform
  domain so account-level rules are not available, and sign-in already gates
  room creation. App-level limits and caps were used instead.
- Guest play without accounts (see Decisions).

## 9. Known gaps and next steps

- The countdown uses the player's local clock against a server deadline (the
  server is still authoritative; a badly wrong clock only affects the display).
- A submit racing the timeout fill in the same millisecond can overwrite a
  safety word (still a valid word).
- No rate limit on `joinGame` attempts; room codes are 5 chars (about 39
  million combinations). No profanity filter on the text-only fallback path.
- The image job queue is one job at a time app-wide; a stuck job is bounded by
  deadlines and a sweep, but heavy concurrent play would queue.
- Generated images are served from fal's URLs; their long-term persistence is
  unknown. Copying them into app file storage is a possible next step.
- The ledger is read in one query (fine at the 400 cap); paging would be needed
  if the cap grows a lot.
- Duplicate display names are allowed; rooms are never listed or discoverable.
- Possible next steps: Turnstile on room creation, per-join rate limiting,
  persistent image storage, a public gallery with moderation.

## 10. Writeup (the submission note)

The note should cover: what was built; which DeepSpace integrations were used
(`anthropic`, `fal`, and `elevenlabs`) and which platform features (realtime records, owner-only
permissions, server actions, background jobs, cron, secrets); why other
integrations were left out; the main tradeoff (server-enforced hidden data and
hard spend caps over feature count; no guests or video); what the agents
did (implementer plus independent reviewer; reviews found a spend hole, an
admin-owner permission bug and stuck-state bugs) versus what the developer
verified by hand (live solo and full rounds, credit usage, the account-owner
bug found by playing); and what is unfinished. Include honest numbers: measured
credits per game and total credits used (read them, do not guess).

## 11. Keeping these docs current (rules)

Documentation drift is a real failure mode here: the next agent will trust this
file. So:

- Any commit that changes behavior, limits or constants, collections or
  permissions, actions, integrations or cost, the deploy or test workflow, or a
  product decision MUST update the matching section of this file in the SAME
  commit. Mapping: constants -> sections 2 and 4; schemas -> the section 4
  table; a new or changed action -> section 4; a deploy -> add a row to the
  section 3 release table with the commit hash; new cost measurements ->
  section 4 cost facts; new bugs or limits -> sections 5 and 9; discarded ideas
  -> section 8; finished or new tasks -> sections 0 and 3.
- Before committing, re-verify any number you are about to write or keep: test
  counts from `npm run test:unit`, constants from `src/game.ts`, release commits
  from `npx deepspace releases`, credits from `npx deepspace app usage --json`.
  Never copy a number from an old report without checking it.
- Mark anything unverified as "unverified" and say why. Do not state a guess as
  a fact.
- Update the date and the snapshot in section 0 whenever you finish a working
  session, and add one line to the session log below.
- Keep `CLAUDE.md` and `AGENTS.md` short. They point here. If you add a new
  rule, write it in section 7 and mirror only the most important lines in the
  two entry files.
- This repo is public: no secrets, tokens, `.dev.vars`, session files, test
  passwords, personal emails or account IDs in any doc.

## 12. Working with the developer (preferences seen so far)

- They want to be ASKED before design decisions that shape the product (player
  counts, tone, sharing, spend limits), with a recommended option. Do not decide
  those silently.
- Plain explanations; say what is verified and what is not. Do not overclaim.
  If something failed or was skipped, say so.
- Cost matters: they do not want to spend money beyond the free credit
  allowance. Always state the expected credit cost before a paid call.
- They approve commits, pushes and deploys explicitly each time.
- They use the two-agent pattern (implementer, then an independent read-only
  reviewer) for risky changes and expect fixes to be re-checked.
- They found a real bug only by playing the live app (the owner-is-admin
  bug: every automated test used ordinary member accounts); recommend a live
  play-through after every deploy.

## 13. Session log

- 2026-11-24 (ET, evening): scaffold, slice 1 (rooms, hidden blanks, timer,
  rate limits, 2-hour expiry), owner-admin fix, slice 2 (model story, safety
  rewrite, images, spend ledger, kill switch, deny-by-default proxy), live
  full-round verified by the developer, handoff docs written and committed.
  Mid-flight: nothing.
- 2026-11-24 (ET, about 8:15 PM): landing sample book, README rewrite and
  submission-note draft added and deployed (commit e9fd4d7); handoff prepared for
  continuing in another agent tool (Codex). Mid-flight: nothing; remaining work
  is the developer's review of the note, the final live round, test-account
  cleanup and submitting.
- 2026-11-24 (ET, evening): added player completion checkmarks and the short
  narrated slideshow. Verified the two-player flow and mocked audio playback.
  A paid live round still needs explicit approval.
- 2026-11-24 (ET, evening): rebuilt the frontend around the three story
  worlds and added host theme selection. Verified the local production landing
  at desktop and phone sizes and the two-player theme flow with generation off.
- 2026-11-24 (ET, evening): generated the landing sample's recording once
  for 10.86 credits and verified browser playback from the saved MP3. Expanded
  new rounds to six pages, with four-page compatibility covered by unit tests
  and six-page navigation verified in the two-player browser test.
- 2026-11-24 (ET, evening): lengthened new pages, rewrote the themed stories
  for drier comedy and stronger continuity, and expanded the finished-book
  reader. Verified desktop and phone layouts, two-player navigation, and
  mocked narration. No paid live longer round was run.
