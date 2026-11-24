# StorybookJam

Co-write a picture book with friends, Mad Libs style, without seeing the story
until it's done.

Try it: https://storybookjam.app.space

## How a round works

1. The host opens a room and shares its code.
2. The app drafts a short story with blanks in it, then hands each blank to a
   different player. You see only your own label ("an animal", "a place",
   "something scary"), never the surrounding text.
3. When every blank is filled, the story is revealed with everyone's words in
   it, and each page gets an illustration.
4. The finished book opens in a reader and gets a link you can share.

The point of the design is that the hidden part is hidden on the server, not
just in the interface: a player's browser never receives words it isn't
supposed to see.

## Where it stands

Work in progress. The app is scaffolded and deployed. Rooms, the fill-in
round and story generation are being built, and this section gets updated as
each one lands.

## What it runs on

- DeepSpace for hosting, sign-in, synced room data and permissions
- A language model for the story draft, called through DeepSpace's
  integration layer
- An image model for the page art, through the same layer
- A spend counter that stops generation when the budget is used up, so the
  app degrades instead of failing

## Run it locally

```bash
npm install
npm run dev
```

## Ship it

```bash
npm run deploy
```

Deploying uploads whatever is committed in your local folder. Pushing to
GitHub only updates the code copy here and does not change the live site.
