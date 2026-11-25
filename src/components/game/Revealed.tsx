/**
 * Finished story: readable during generation, with a shared recording
 * per page and a local slideshow transport for each player.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronLeft, ChevronRight, Headphones, Pause } from 'lucide-react'
import { useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { callAction } from '@/lib/callAction'
import { MAX_PAGE_RETRIES, pageMediaInFlight, storyPageCount } from '../../game'
import type { GamePhase } from '../../game'
import type { PageView } from './types'
import { getStoryTheme, type StoryThemeId } from '../../story-themes'
import { ThemeArtwork } from './ThemeArtwork'

/** While illustrating, nudge the server now and then so a stuck room self-heals (tick sweeps stale pages). */
const SWEEP_NUDGE_MS = 30_000
/** Text in a silent slide stays visible for at least a few seconds. */
const MIN_READ_MS = 4_000
const READ_MS_PER_CHARACTER = 65

type StoryProps = { gameId: string; title: string; phase: GamePhase; storyTheme?: StoryThemeId; pageCount?: number }

export function Revealed(props: StoryProps) {
  return <StorySlideshow key={props.gameId} {...props} />
}

type Clip = { idx: number; audioUrl: string }

function StorySlideshow({ gameId, title, phase, storyTheme, pageCount }: StoryProps) {
  const theme = getStoryTheme(storyTheme)
  const totalPages = storyPageCount(pageCount)
  const { records, status } = useQuery<PageView>('pages', { where: { gameId } })
  const pages = [...records].sort((a, b) => a.data.idx - b.data.idx)
  const drawable = pages.filter((p) => p.data.imageStatus !== 'skipped').length
  const ready = pages.filter((p) => p.data.imageStatus === 'ready').length
  const bookReady = phase === 'ready' && pages.length === totalPages && !pages.some(({ data }) => pageMediaInFlight(data))
  const hasNarration = pages.some(({ data }) => data.narrationStatus === 'ready')
  const [clips, setClips] = useState<Clip[] | null>(null)
  const [clipLoad, setClipLoad] = useState(0)
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [mediaError, setMediaError] = useState<number | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const attemptedAutoplay = useRef(false)
  const playbackAttempt = useRef(0)
  const clip = clips?.find(({ idx }) => idx === active)
  const firstClipUrl = clips?.find(({ idx }) => idx === 0)?.audioUrl
  const narratable = (clips?.length ?? 0) > 0
  const silentPage = !clip || mediaError === active
  const textLength = pages.find(({ data }) => data.idx === active)?.data.text.length ?? 0

  useEffect(() => {
    if (!bookReady || !hasNarration) return
    let ignore = false
    void callAction<Clip[]>('getNarration', { gameId }).then((result) => {
      if (!ignore) setClips(result.success ? result.data : [])
    })
    return () => { ignore = true }
  }, [bookReady, hasNarration, gameId, clipLoad])

  const startPlayback = useCallback((url: string | undefined, idx: number) => {
    const player = audio.current
    if (!player) return
    const attempt = ++playbackAttempt.current
    setBlocked(false)
    setMediaError(null)
    setPlaying(true)
    if (!url) {
      player.pause()
      player.removeAttribute('src')
      return
    }
    if (player.getAttribute('src') !== url) player.src = url
    void player.play().catch((error: unknown) => {
      if (attempt !== playbackAttempt.current) return
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setPlaying(false)
        setBlocked(true)
      } else {
        setMediaError(idx)
      }
    })
  }, [])

  useEffect(() => {
    if (!bookReady || !narratable || attemptedAutoplay.current) return
    attemptedAutoplay.current = true
    startPlayback(firstClipUrl, 0)
  }, [bookReady, firstClipUrl, narratable, startPlayback])

  function pausePlayback() {
    playbackAttempt.current++
    audio.current?.pause()
    setPlaying(false)
    setBlocked(false)
  }

  function goTo(idx: number) {
    if (idx === active) return
    attemptedAutoplay.current = true
    pausePlayback()
    audio.current?.removeAttribute('src')
    setMediaError(null)
    setActive(idx)
  }

  const advance = useCallback(() => {
    if (!playing) return
    const next = active + 1
    if (next >= totalPages) {
      setPlaying(false)
      return
    }
    setActive(next)
    const nextClip = clips?.find(({ idx }) => idx === next)
    startPlayback(nextClip?.audioUrl, next)
  }, [playing, active, clips, startPlayback, totalPages])

  useEffect(() => {
    if (!playing || !silentPage) return
    const timeout = setTimeout(advance, Math.max(MIN_READ_MS, textLength * READ_MS_PER_CHARACTER))
    return () => clearTimeout(timeout)
  }, [advance, playing, silentPage, textLength])

  useEffect(() => {
    if (phase !== 'generating') return
    const t = setInterval(() => void callAction('tick', { gameId }), SWEEP_NUDGE_MS)
    return () => clearInterval(t)
  }, [phase, gameId])

  return (
    <div className="jam-room jam-container max-w-4xl space-y-5 py-7 sm:py-12" data-world={theme.id}>
      <header className="text-center">
        <p className="jam-eyebrow mb-2 justify-center" data-testid="active-story-theme"><BookOpen size={17} aria-hidden /> {theme.name}</p>
        <h1 className="jam-display" data-testid="story-title">{title || 'Your story'}</h1>
      </header>

      {drawable > 0 && (
        <p className="text-center text-sm text-muted-foreground" data-testid="illustration-progress">
          {ready} of {drawable} illustrations ready
        </p>
      )}

      {status === 'loading' || (pages.length === 0 && status !== 'error') ? (
        <p className="text-center text-muted-foreground">Unrolling the story...</p>
      ) : (
        <section aria-label="Story pages" className="jam-stage space-y-4 p-3 sm:p-4">
          {pages.map((p) => (
            <PageCard key={p.recordId} gameId={gameId} page={p.data} theme={theme.id} totalPages={totalPages} hidden={p.data.idx !== active} />
          ))}
          <div className="flex flex-wrap items-center justify-center gap-2" aria-label="Page navigation">
            <Button variant="outline" aria-label="Previous" disabled={!pages.some(({ data }) => data.idx === active - 1)} onClick={() => goTo(active - 1)}><ChevronLeft aria-hidden /><span className="hidden sm:inline">Previous</span></Button>
            {pages.map(({ recordId, data: { idx } }) => (
              <Button key={recordId} size="sm" variant={idx === active ? 'default' : 'outline'}
                aria-label={`Page ${idx + 1}`} aria-current={idx === active ? 'page' : undefined} onClick={() => goTo(idx)}>
                {idx + 1}
              </Button>
            ))}
            <Button variant="outline" aria-label="Next" disabled={!pages.some(({ data }) => data.idx === active + 1)} onClick={() => goTo(active + 1)}><span className="hidden sm:inline">Next</span><ChevronRight aria-hidden /></Button>
          </div>
        </section>
      )}

      {/* Keep one media element so user-granted playback carries over between pages. */}
      <audio ref={audio} preload="auto" onEnded={() => { if (!silentPage) advance() }} onError={() => {
        if (!audio.current?.error || !audio.current.hasAttribute('src')) return
        playbackAttempt.current++
        setMediaError(active)
      }} data-testid="story-audio" />
      {phase === 'generating' && pages.some(({ data }) => data.narrationStatus === 'pending') && (
        <p className="text-center text-sm text-muted-foreground" role="status">Getting the read-aloud ready…</p>
      )}
      {bookReady && hasNarration && clips?.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">
          Narration could not load.{' '}
          <button type="button" className="underline" onClick={() => { setClips(null); setClipLoad((n) => n + 1) }}>Try again</button>
        </p>
      )}
      {narratable && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => playing ? pausePlayback() : startPlayback(clip?.audioUrl, active)}>
            {playing ? <Pause aria-hidden /> : <Headphones aria-hidden />}
            {playing ? 'Pause narration' : 'Play narration'}
          </Button>
          {active > 0 && (
            <Button type="button" variant="outline" onClick={() => { setActive(0); startPlayback(firstClipUrl, 0) }}>
              Replay from start
            </Button>
          )}
        </div>
      )}
      {bookReady && blocked && <p className="text-center text-sm text-muted-foreground" role="status">Tap Play narration to listen.</p>}
      {bookReady && mediaError === active && <p className="text-center text-sm text-muted-foreground" role="status">This page’s audio could not play. You can still read and turn pages.</p>}
      {bookReady && clips && clips.length > 0 && !clip && <p className="text-center text-sm text-muted-foreground">Narration is unavailable for this page.</p>}

      {/* Always a way out, even while illustrating. */}
      <div className="text-center">
        <Link
          to="/home"
          data-testid={phase === 'generating' ? 'back-home' : 'play-again'}
          className="jam-text-link text-primary"
        >
          {phase === 'generating' ? 'Back home' : 'Play again'}
        </Link>
      </div>
    </div>
  )
}

function PageCard({ gameId, page, theme, totalPages, hidden }: {
  gameId: string
  page: PageView
  theme: StoryThemeId
  totalPages: number
  hidden: boolean
}) {
  return (
    <article hidden={hidden} className="jam-story-page rounded-lg border border-border" data-testid="story-page">
      <Illustration gameId={gameId} page={page} theme={theme} />
      <div className="flex min-w-0 flex-col justify-center p-5 sm:p-7">
        <p className="jam-eyebrow mb-3">
          Page {page.idx + 1} of {totalPages}
        </p>
        <p className="jam-story-copy leading-relaxed break-words">{page.text}</p>
      </div>
    </article>
  )
}

/** Fixed 4:3 box for every state, so nothing jumps when an image arrives. */
function Illustration({ gameId, page, theme }: { gameId: string; page: PageView; theme: StoryThemeId }) {
  const { error } = useToast()
  const [retrying, setRetrying] = useState(false)
  const box = 'flex aspect-[4/3] w-full items-center justify-center bg-muted text-sm text-muted-foreground'
  const retriesLeft = MAX_PAGE_RETRIES - (page.retries ?? 0)

  async function retry() {
    setRetrying(true)
    const res = await callAction('retryPage', { gameId, idx: page.idx })
    setRetrying(false)
    if (!res.success) error('Could not retry', res.error)
  }

  switch (page.imageStatus) {
    case 'ready':
      return (
        <div className="aspect-[4/3] w-full bg-muted" data-testid="illustration-ready">
          <img
            src={page.imageUrl}
            alt={`Illustration for page ${page.idx + 1}`}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      )
    case 'failed':
      return (
        <div className={`${box} flex-col gap-3`} data-testid="illustration-failed">
          <span>The illustration did not work out.</span>
          {retriesLeft > 0 ? (
            <Button size="sm" variant="outline" loading={retrying} onClick={retry} data-testid="retry-illustration">
              Retry
            </Button>
          ) : (
            <span className="text-xs">No retries left for this page.</span>
          )}
        </div>
      )
    case 'skipped':
      return (
        <div className="jam-story-placeholder relative aspect-[4/3]" data-testid="illustration-skipped">
          <ThemeArtwork theme={theme} decorativeOnly />
          <span className="absolute right-2 bottom-2 rounded bg-card px-2 py-1 text-xs font-semibold text-muted-foreground">Text-only page</span>
        </div>
      )
    case 'generating':
      return (
        <div className={`${box} animate-pulse`} data-testid="illustration-generating">
          Drawing...
        </div>
      )
    default: // pending
      return (
        <div className={`${box} animate-pulse`} data-testid="illustration-pending">
          Waiting to draw...
        </div>
      )
  }
}
