# StorybookJam

- [Play StorybookJam](https://storybookjam.app.space/)
- [Read the source on GitHub](https://github.com/Isaac-Loc/StorybookJam/tree/dev)

I built a multiplayer fill-in-the-blank party game. The host opens a room,
picks a theme, and shares the code. Players see their own secret prompts one
at a time and have 75 seconds to fill them. Everyone discovers what they
wrote together when the six-page illustrated story starts reading itself aloud. The landing
page has a free sample, *The Fax Machine Knows*, that anyone can read or listen
to without signing in.

The hardest part was keeping the surprise fair. I used DeepSpace's synced
records and server-side permissions so another player's blanks, the story
draft, and the image prompts never reach your browser before the reveal.
Server actions check who is allowed to start a room or submit a word.
Background jobs create the media and cron deletes expired rooms.

Claude drafts the story and does a safety rewrite. Fal illustrates each
page, and ElevenLabs reads the finished text. The slideshow advances when
each clip ends and provides a play button if the browser blocks autoplay.
I left out video to keep the game fast and the generation cost predictable.
The sample art was made with the built-in image generator in Codex and its
audio was made offline, so playing it uses no DeepSpace generation credits.

I worked with Claude Code and Codex to build and test the project. Independent
agent reviews helped catch an integration spending hole, a job authorization
gap, and a reveal that could get stuck. An early live playthrough caught an
owner-specific bug: the owner's admin role couldn't read its own blanks.
There's now a regression test for that case.

I used a two-player Playwright test to check that the theme choice and
completion checkmarks sync, other players' words stay off the WebSocket
before the reveal, and both players can read the finished story. The
production build, 169 unit tests, and 14 browser tests passed. Browser
tests use the free text fallback, and the live release and public sample
assets were checked separately.

Generation has a server-only ledger, per-host and app-wide limits, and a
kill switch. As of November 24 ET, the account had used 64.78 of 500 credits
during development. A fully illustrated and narrated six-page story is
estimated at roughly 32–37 credits at the current text limit, before image
retries. A full round at that limit hasn't been measured live.

Given more time, I'd measure a few complete live rounds, rate-limit room-code
attempts, and test simultaneous joins at the room limit.
