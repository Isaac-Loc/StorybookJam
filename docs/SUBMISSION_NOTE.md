# Submission note (draft: edit into your own voice, then paste into the portal)

Numbers below were read from the CLI and the repo on 2026-11-24. Re-check any
number you change. Lines marked [CONFIRM] are things only you can attest to.

**Live URL:** https://storybookjam.app.space
**Repository:** https://github.com/Isaac-Loc/StorybookJam (branch `dev`)

## What I built

StorybookJam is a multiplayer Mad-Libs picture book. A signed-in host opens a
room; each player is secretly dealt blanks and sees only their own labels. A
75-second server timer (with "safety words") fills what players don't. Claude
writes a fresh four-page silly story, a second model pass rewrites any harmful
player word, and four illustrations are generated and shown page by page.
Rooms expire after two hours and are deleted.

The technical core is that hidden data is hidden by the server: record
permissions mean another player's browser never receives your blank, the story
template or the image prompts. A two-account Playwright test checks the
WebSocket traffic for this.

## DeepSpace integrations and platform features used

- Integrations: `anthropic/chat-completion` (story draft and safety rewrite)
  and `fal/run-model` + `fal/get-result` (FLUX schnell illustrations), called
  only from server actions and a background job.
- Platform features: synced records with owner-only permissions, server actions
  (RBAC-off, so each action authorizes the caller), the background job room,
  a cron task for room cleanup, secrets/env for a generation kill switch, and
  one-command deploys.
- Left out on purpose: audio/narration (extra cost, no new value), video
  (fal compute-priced runs reserve $2, too expensive for a free allowance),
  and other integrations that wouldn't improve the game. I also explored music
  as the product (Deezer, iTunes, Spotify, YouTube, Audius). Their terms or
  limits ruled out a free, ad-free, rule-compliant game, so I changed the idea
  instead of working around the terms.

## Main tradeoff

I chose server-enforced hidden data and hard spend controls over feature
count. That meant requiring sign-in for everyone (DeepSpace's anonymous
connections have no stable identity, so guests couldn't hold a hidden blank)
and keeping generation behind caps: 400 estimated credits overall and 120 per
host, a kill switch, and a browser route that refuses every paid integration.
The caps are deliberately conservative estimates: a game's four images measured
about 5.6 credits (about 1.4 each, settled) plus roughly 0.3 for the two model
calls, so one game is about 6 credits and the real headroom is larger.

## What the agent did, and what I verified

- I directed Claude (Claude Code) through the design with questions at each
  product decision. It built the app with an implementer-then-reviewer process:
  one agent wrote each slice, a second independent read-only agent reviewed it,
  and I re-ran type-check, lint, unit tests and the build myself before each
  commit.
- The reviews found real problems that were then fixed: a spend hole (any
  signed-in user could call a paid integration through the generic proxy, so
  the proxy is now deny-by-default), a paid job any member could trigger (now
  admin-only), a game that could stay stuck in "generating", and a prompt that
  a player word could break out of.
- I found one bug by playing the live app myself: as the app owner I'm an
  automatic admin, and admins couldn't read their own blanks. No automated test
  caught it because every test account was an ordinary member. It is fixed and
  now has a regression test. [CONFIRM: your own wording of what you played]
- Test status: 153 unit tests (13 files) plus a 3-test Playwright spec that
  runs with generation off so it spends nothing; all pass at the last run.
- Credits: 33.7 of the 500-credit free allowance used in total (466.3 left) as
  of this draft, including all development testing and the sample
  illustrations. Re-read with `npx deepspace app usage --json` before
  submitting.

## What is unfinished and what I'd do next

- Not covered by automated tests: the full-room (7th player) case, true
  simultaneous joins, crash recovery inside the Durable Object, and a real
  failed image followed by a manual Retry.
- Generated images are served from fal's URLs; copying them into app storage
  would make them permanent.
- Next: Cloudflare Turnstile on room creation, rate limiting on join attempts,
  persistent image storage, and optional narration.
