# StorybookJam

Co-write an absurd story with friends, Mad Libs style, without seeing the
story until it's done.

Try it: https://storybookjam.app.space

## How a round works

1. A signed-in host opens a room, picks a story theme, and shares its code.
   Play solo or with up to six players.
2. Claude writes a six-page story with six blanks and up to 200 characters
   per page. Each blank is
   secretly dealt to a player. You see only your own labels ("an animal", "a
   place"), never the surrounding story.
3. A 75-second timer runs. Stuck? Tap "Use a safety word". When time runs out
   the server fills whatever is left.
4. When every blank is filled, a second model pass swaps harmful words for
   harmless ones. Illustrations and narration are generated for each page,
   and the read-aloud advances the slideshow.
5. Rooms expire after two hours. Player stories are private. Anyone can read
   or listen to the [sample](https://storybookjam.app.space/#sample), no sign-in
   required.

The design point: the hidden part is hidden on the server, not just in the
interface. A player's browser never receives words, story text or image prompts
it isn't supposed to see.

## Built with

- DeepSpace: hosting, sign-in, synced records with per-row permissions, server
  actions, a background job room for illustrations and narration, and a cron task that
  deletes expired rooms.
- `anthropic` (story draft and safety rewrite), `fal` (illustrations), and `elevenlabs` (narration),
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
End-to-end tests (`npx deepspace test run tests/game.spec.ts`) run with model
generation switched off so they cost nothing.

## Ship it

```bash
npm run deploy
```

Deploying uploads whatever is committed in your local folder. Pushing to
GitHub only updates the code copy here and does not change the live site.
