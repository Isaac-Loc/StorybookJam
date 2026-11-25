/**
 * Finished story: four page cards. The text is readable the moment the story
 * is revealed; each illustration fills in live as its page row updates
 * (`useQuery('pages')` streams every change).
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import { Button, useToast } from '@/components/ui'
import { callAction } from '@/lib/callAction'
import { MAX_PAGE_RETRIES, PAGE_COUNT } from '../../game'
import type { GamePhase } from '../../game'
import type { PageView } from './types'

/** While illustrating, nudge the server now and then so a stuck room self-heals (tick sweeps stale pages). */
const SWEEP_NUDGE_MS = 30_000

export function Revealed({ gameId, title, phase }: { gameId: string; title: string; phase: GamePhase }) {
  const { records, status } = useQuery<PageView>('pages', { where: { gameId } })
  const pages = [...records].sort((a, b) => a.data.idx - b.data.idx)
  const drawable = pages.filter((p) => p.data.imageStatus !== 'skipped').length
  const ready = pages.filter((p) => p.data.imageStatus === 'ready').length

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
        pages.map((p) => <PageCard key={p.recordId} gameId={gameId} page={p.data} />)
      )}

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

function PageCard({ gameId, page }: { gameId: string; page: PageView }) {
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card" data-testid="story-page">
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
