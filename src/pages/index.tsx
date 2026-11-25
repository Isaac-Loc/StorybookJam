/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 *
 * The sample book below is fixed, committed content (public/sample/*): the page
 * never calls a model, so visitors can see the output without spending credits.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

/** Sample book: the text was written by hand for this demo; the pictures were
 *  generated with the same image model, size and style the app uses. */
const SAMPLE_TITLE = 'Pip and the Giant Spatula'
const SAMPLE_PAGES = [
  {
    text: 'In the town of Wobblebottom, there lived a very fluffy penguin named Pip, who loved pancakes more than anything in the whole world.',
    alt: 'A fluffy penguin in a red scarf hugging a tall stack of pancakes in a colorful town',
  },
  {
    text: 'One morning, Pip found a giant spatula standing in the middle of the road. Every time anyone came close, it went BONK.',
    alt: 'A surprised penguin on a country road looking up at a giant silver spatula',
  },
  {
    text: 'Pip tried to push it away, but it only grew bigger. “Only pancakes can stop this!” he shouted.',
    alt: 'The penguin pushing a huge spatula while villagers watch from their windows',
  },
  {
    text: 'So Pip flipped a pancake as big as a trampoline. The spatula scooped it up and floated into the sky going BONK, and Pip never complained about Mondays again. The end.',
    alt: 'A giant spatula and a huge pancake floating in a pink sunset sky above a smiling penguin',
  },
] as const

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="flex min-h-screen flex-col items-center px-6 pb-24 text-center">
        <section className="flex flex-col items-center py-24">
          <p className="mb-3 text-sm uppercase tracking-widest text-muted-foreground">{APP_NAME}</p>
          <h1 className="mb-4 max-w-2xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Build a silly story together, one secret blank at a time
          </h1>
          <p className="mb-8 max-w-md text-muted-foreground">
            Start a room and share the code with friends. Everyone gets a few secret blanks to fill
            in ("an animal", "a food", "a sound") without ever seeing the story. When the last blank
            is filled, the whole absurd tale is revealed and illustrated.
          </p>
          <Link
            to="/home"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Play now
          </Link>
        </section>

        <section aria-labelledby="sample-heading" className="w-full max-w-3xl">
          <h2 id="sample-heading" className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            A sample book: {SAMPLE_TITLE}
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-sm text-muted-foreground">
            Sample only. The words were written by hand for this page; the pictures come from the same
            image model and style the game uses. In a real room, Claude writes a fresh story every time
            and your friends' words are in it.
          </p>
          <ol className="flex flex-col gap-8 text-left">
            {SAMPLE_PAGES.map((page, i) => (
              <li key={i} className="overflow-hidden rounded-xl border border-border bg-card">
                <img
                  src={`/sample/page-${i + 1}.jpg`}
                  alt={page.alt}
                  width={768}
                  height={576}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  className="aspect-[4/3] w-full object-cover"
                />
                <p className="px-5 py-4 text-base leading-relaxed text-foreground">
                  <span className="mr-2 text-sm text-muted-foreground">Page {i + 1}</span>
                  {page.text}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-10">
            <Link
              to="/home"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Make your own
            </Link>
          </div>
        </section>
      </div>
    </>
  )
}
