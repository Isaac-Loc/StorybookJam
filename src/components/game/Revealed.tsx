/** Revealed phase: the finished story as readable page cards. */

import { Link } from 'react-router-dom'
import { useQuery } from 'deepspace'
import type { PageView } from './types'

export function Revealed({ gameId, title }: { gameId: string; title: string }) {
  const { records, status } = useQuery<PageView>('pages', { where: { gameId } })
  const pages = [...records].sort((a, b) => a.data.idx - b.data.idx)

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <h1 className="text-center text-3xl font-bold tracking-tight" data-testid="story-title">
        {title || 'Your story'}
      </h1>

      {status === 'loading' || (pages.length === 0 && status !== 'error') ? (
        <p className="text-center text-muted-foreground">Unrolling the story...</p>
      ) : (
        pages.map((p) => (
          <article key={p.recordId} className="rounded-lg border border-border bg-card p-6" data-testid="story-page">
            <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Page {p.data.idx + 1}</p>
            <p className="text-lg leading-relaxed">{p.data.text}</p>
          </article>
        ))
      )}

      <div className="text-center">
        <Link
          to="/home"
          data-testid="play-again"
          className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Play again
        </Link>
      </div>
    </div>
  )
}
