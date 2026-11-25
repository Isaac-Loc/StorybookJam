# StorybookJam

Co-write a picture book with friends, Mad Libs style, without seeing the story
until it's done.

Try it: https://storybookjam.app.space

## How a round works

1. A signed-in host opens a room and shares its 5-letter code (up to 6 players;
   playing solo works too).
2. Claude writes a short, silly four-page story with six blanks. Each blank is
   secretly dealt to a player. You see only your own labels ("an animal", "a
   place"), never the surrounding story.
3. A 75-second timer runs. Stuck? Tap "Use a safety word". When time runs out
   the server fills whatever is left.
4. When every blank is filled, a second model pass swaps any harmful word for a
   harmless one, and four illustrations are generated page by page.
5. Rooms expire after two hours and are deleted. Nothing is made public.

The design point: the hidden part is hidden on the server, not just in the
interface. A player's browser never receives words, story text or image prompts
it isn't supposed to see.

## Built with

- DeepSpace: hosting, sign-in, synced records with per-row permissions, server
  actions, a background job room for image generation, and a cron task that
  deletes expired rooms.
- `anthropic` (story draft and safety rewrite) and `fal` (page illustrations),
  called only from the server through DeepSpace's integration layer.
- Spend controls: a server-only ledger caps estimated generation spend
  globally and per host, a kill switch turns generation off, and the browser
  can't reach paid integrations directly. Without generation the game falls
  back to a fixed story and text only.

More detail for contributors and agents: [docs/HANDOFF.md](./docs/HANDOFF.md).

## Development

```bash
npm install
npm run dev
```

Checks before a commit: `npm run type-check && npm run lint && npm run test:unit && npm run build`.
End-to-end tests (`npx deepspace test run tests/game.spec.ts`) run with image
generation switched off so they cost nothing.

## Ship it

```bash
npm run deploy
```

Deploying uploads whatever is committed in your local folder. Pushing to
GitHub only updates the code copy here and does not change the live site.
