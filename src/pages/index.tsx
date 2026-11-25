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
 * The sample book and recording are bundled assets. Visiting the page and
 * playing the audio do not use generation credits.
 */

import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, BookOpen, Headphones, PencilLine, Users } from 'lucide-react'
import { Brand } from '../components/Brand'
import sampleNarrationUrl from '../assets/fax-demo-narration.wav?url'
import { ThemeArtwork } from '../components/game/ThemeArtwork'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import { STORY_THEMES } from '../story-themes'
import { SAMPLE_PAGES, SAMPLE_TITLE } from '../sample-story'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="jam-landing">
        <header className="jam-site-header">
          <div className="jam-container jam-header-inner">
            <Brand />
            <nav aria-label="Explore StorybookJam" className="jam-public-nav">
              <a href="#worlds">Story themes</a>
              <a href="#how-to-play">How to play</a>
            </nav>
            <Link to="/home" className="jam-button jam-button-small jam-button-outline">Play now <ArrowRight size={16} aria-hidden /></Link>
          </div>
        </header>

        <main>
          <section aria-labelledby="hero-heading" className="jam-container jam-hero">
            <div>
              <p className="jam-eyebrow"><span className="jam-dot" /> A fill-in-the-blank party game</p>
              <h1 id="hero-heading" className="jam-hero-title">Make a story.<br /><em>Make it weird.</em></h1>
              <p className="jam-hero-copy">Give your friends a few secret prompts. Their answers turn into an illustrated story you get to hear together.</p>
              <div className="jam-hero-actions">
                <Link to="/home" className="jam-button">Start playing <ArrowRight size={19} aria-hidden /></Link>
                <a href="#sample" className="jam-text-link">See a sample <ArrowDown size={16} aria-hidden /></a>
              </div>
              <p className="jam-hero-note"><Users size={17} aria-hidden /> Play solo or with up to six players</p>
            </div>

            <div className="jam-hero-art">
              <img src="/story-art/hero.jpg" alt="A haunted fax machine unspools visions of a rocket, a tiny adventurer, and a lonely office." width={1200} height={900} fetchPriority="high" />
            </div>
          </section>

          <section id="worlds" className="jam-world-section">
            <div className="jam-container">
              <div className="jam-section-heading">
                <h2>Pick a story world.</h2>
                <p>The host chooses the theme. Everyone helps write what happens next.</p>
              </div>
              <div className="jam-world-grid">
                {STORY_THEMES.map((theme) => (
                  <article key={theme.id} className="jam-world-card" data-world={theme.id}>
                    <ThemeArtwork theme={theme.id} />
                    <div><h3>{theme.name}</h3><p>{theme.description}</p></div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="how-to-play" className="jam-container jam-how">
            <div className="jam-section-heading">
              <h2>How to play.</h2>
            </div>
            <ol className="jam-step-grid">
              <li><Users aria-hidden /><h3>Get a room</h3><p>Pick a world and send friends an invite link or room code.</p></li>
              <li><PencilLine aria-hidden /><h3>Fill your blanks</h3><p>See your own prompts and add words before time runs out.</p></li>
              <li><Headphones aria-hidden /><h3>Hear the reveal</h3><p>Follow the illustrations as your finished book is read aloud.</p></li>
            </ol>
          </section>

          <section id="sample" className="jam-sample-section" aria-labelledby="sample-heading">
            <div className="jam-container">
              <div className="jam-section-heading">
                <div><p className="jam-eyebrow"><BookOpen size={18} aria-hidden /> Sample book</p><h2 id="sample-heading">{SAMPLE_TITLE}</h2></div>
                <p>A dry office comedy from Silly Surprise.</p>
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
                <p id="sample-audio-label" className="flex items-center gap-2 px-1 font-bold">
                  <Headphones size={18} aria-hidden /> Listen to the sample
                </p>
                <audio aria-labelledby="sample-audio-label" className="h-10 w-full max-w-md" controls preload="none" src={sampleNarrationUrl} />
              </div>
              <ol className="jam-sample-grid">
                {SAMPLE_PAGES.map((page, i) => (
                  <li key={page.alt}>
                    <img src={`/story-art/fax-page-${i + 1}.jpg`} alt={page.alt} width={960} height={720} loading="lazy" />
                    <div><p className="jam-eyebrow">Page {i + 1}</p><p>{page.text}</p></div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </main>
        <footer className="jam-footer">
          <div className="jam-container jam-header-inner">
            <Brand />
            <Link to="/home" className="jam-button jam-button-small">Make your own <ArrowRight size={17} aria-hidden /></Link>
          </div>
        </footer>
      </div>
    </>
  )
}
