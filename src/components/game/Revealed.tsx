/**
 * Finished story: readable during generation, with a shared recording
 * per page and a local slideshow transport for each player.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { callAction } from '@/lib/callAction'
import { MAX_PAGE_RETRIES, PAGE_COUNT, pageMediaInFlight } from '../../game'
import type { GamePhase } from '../../game'
import type { PageView } from './types'

/** While illustrating, nudge the server now and then so a stuck room self-heals (tick sweeps stale pages). */
const SWEEP_NUDGE_MS = 30_000
/** Text in a silent slide stays visible for at least a few seconds. */
const MIN_READ_MS = 4_000
const READ_MS_PER_CHARACTER = 65

export function Revealed({ gameId, title, phase }: { gameId: string; title: string; phase: GamePhase }) {
  return <StorySlideshow key={gameId} gameId={gameId} title={title} phase={phase} />
}

type Clip = { idx: number; audioUrl: string }

function StorySlideshow({ gameId, title, phase }: { gameId: string; title: string; phase: GamePhase }) {
  const { records, status } = useQuery<PageView>('pages', { where: { gameId } })
  const pages = [...records].sort((a, b) => a.data.idx - b.data.idx)
  const drawable = pages.filter((p) => p.data.imageStatus !== 'skipped').length
  const ready = pages.filter((p) => p.data.imageStatus === 'ready').length
  const bookReady = phase === 'ready' && pages.length === PAGE_COUNT && !pages.some(({ data }) => pageMediaInFlight(data))
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
    if (next >= PAGE_COUNT) {
      setPlaying(false)
      return
    }
    setActive(next)
    const nextClip = clips?.find(({ idx }) => idx === next)
    startPlayback(nextClip?.audioUrl, next)
  }, [playing, active, clips, startPlayback])

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
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-center text-3xl font-bold tracking-tight" data-testid="story-title">
        {title || 'Your story'}
      </h1>

      {drawable > 0 && (
        <p className="text-center text-sm text-muted-foreground" data-testid="illustration-progress">
          {ready} of {drawable} illustrations ready
        </p>
      )}

      {status === 'loading' || (pages.length === 0 && status !== 'error') ? (
        <p className="text-center text-muted-foreground">Unrolling the story...</p>
      ) : (
        <section aria-label="Story pages" className="space-y-4">
          {pages.map((p) => (
            <PageCard key={p.recordId} gameId={gameId} page={p.data} hidden={p.data.idx !== active} />
          ))}
          <div className="flex flex-wrap items-center justify-center gap-2" aria-label="Page navigation">
            <Button variant="outline" disabled={!pages.some(({ data }) => data.idx === active - 1)} onClick={() => goTo(active - 1)}>Previous</Button>
            {pages.map(({ recordId, data: { idx } }) => (
              <Button key={recordId} size="sm" variant={idx === active ? 'default' : 'outline'}
                aria-label={`Page ${idx + 1}`} aria-current={idx === active ? 'page' : undefined} onClick={() => goTo(idx)}>
                {idx + 1}
              </Button>
            ))}
            <Button variant="outline" disabled={!pages.some(({ data }) => data.idx === active + 1)} onClick={() => goTo(active + 1)}>Next</Button>
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
          className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {phase === 'generating' ? 'Back home' : 'Play again'}
        </Link>
      </div>
    </div>
  )
}

function PageCard({ gameId, page, hidden }: { gameId: string; page: PageView; hidden: boolean }) {
  return (
    <article hidden={hidden} className="overflow-hidden rounded-lg border border-border bg-card" data-testid="story-page">
      <Illustration gameId={gameId} page={page} />
      <div className="p-6">
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Page {page.idx + 1} of {PAGE_COUNT}
        </p>
        <p className="text-lg leading-relaxed">{page.text}</p>
      </div>
    </article>
  )
}

/** Fixed 4:3 box for every state, so nothing jumps when an image arrives. */
function Illustration({ gameId, page }: { gameId: string; page: PageView }) {
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
        <div className={box} data-testid="illustration-skipped">
          No illustration for this page
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
