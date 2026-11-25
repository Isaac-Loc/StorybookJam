/**
 * Filling phase: my secret blank(s), a countdown, and shared progress.
 *
 * `useQuery('blanks')` only ever returns MY rows: the Durable Object filters by
 * `ownerField: 'assignedTo'` before sending, so there is nothing to hide here.
 *
 * The countdown is display-only. When it hits zero every browser calls the
 * `tick` action; the server decides whether time is really up (the client
 * clock may run a little fast or slow) so we keep re-calling every 3 s until
 * the phase leaves `filling`.
 */

import { useEffect, useState } from 'react'
import { Check, Clock3 } from 'lucide-react'
import { Badge, Button, Input, useToast } from '@/components/ui'
import { useQuery } from 'deepspace'
import { callAction } from '@/lib/callAction'
import { WORD_MAX_LENGTH } from '../../game'
import { getStoryTheme } from '../../story-themes'
import type { BlankView, GameView } from './types'

const TICK_RETRY_MS = 3000

/** Whole seconds left until `endsAt` (epoch ms); re-renders ~4x per second. */
function useSecondsLeft(endsAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

export function Filling({ gameId, game }: { gameId: string; game: GameView }) {
  const { records, status } = useQuery<BlankView>('blanks', { where: { gameId } })
  const secondsLeft = useSecondsLeft(game.phaseEndsAt)
  const expired = secondsLeft <= 0
  // Everything is filled but we are still in `filling`: the server's reveal
  // failed once, and tick retries it (it is idempotent), so keep nudging it.
  const allFilled = game.totalBlanks > 0 && game.filledCount >= game.totalBlanks
  const needsTick = expired || allFilled

  // NOTE: the countdown uses the browser clock, not a server offset. A skewed
  // clock only changes WHEN we first call tick; the server alone decides
  // whether time is up, and we keep retrying until the phase changes.
  useEffect(() => {
    if (!needsTick) return
    void callAction('tick', { gameId })
    const t = setInterval(() => void callAction('tick', { gameId }), TICK_RETRY_MS)
    return () => clearInterval(t) // also runs on unmount (phase flips to revealed)
  }, [needsTick, gameId])

  const mine = [...records].sort((a, b) => a.data.idx - b.data.idx)
  const mm = String(Math.floor(secondsLeft / 60))
  const ss = String(secondsLeft % 60).padStart(2, '0')
  const theme = getStoryTheme(game.storyTheme)

  return (
    <div className="jam-room jam-container max-w-2xl space-y-5 py-8 sm:py-12" data-world={theme.id}>
      <header className="jam-stage p-4 sm:p-6">
        <ul aria-label="Player progress" className="mb-4 flex flex-wrap gap-2" data-testid="player-progress">
          {game.playerIds.map((id) => {
            const finished = game.finishedPlayerIds?.includes(id) ?? false
            return (
              <li key={id} data-finished={finished} className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm font-semibold data-[finished=true]:border-green-700/30 data-[finished=true]:bg-green-50">
                <span className="min-w-0 break-words">{game.playerNames[id] ?? 'Player'}</span>
                {finished && <Check aria-hidden="true" className="size-4 shrink-0 text-green-800" />}
                <span className="sr-only">: {finished ? 'Finished' : 'Still filling words'}</span>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="jam-eyebrow mb-1" data-testid="active-story-theme">{theme.name}</p>
            <h1 className="jam-display">Fill the blanks.</h1>
          </div>
          <p className="flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 font-mono text-2xl font-bold tabular-nums" data-testid="countdown">
            <Clock3 size={18} aria-hidden /> {mm}:{ss}
          </p>
        </div>
        <p className="mt-3 text-sm font-semibold text-muted-foreground" data-testid="progress">{game.filledCount} of {game.totalBlanks} blanks filled</p>
        <progress className="mt-1 h-2 w-full accent-primary" value={game.filledCount} max={game.totalBlanks || 1} aria-label="Blanks filled" />
        {expired && <p className="mt-1 text-sm font-semibold">Time is up! Finishing the story...</p>}
      </header>

      {status === 'loading' && <p className="text-center text-muted-foreground">Loading your blanks...</p>}
      {status !== 'loading' && mine.length === 0 && (
        <p className="text-center text-muted-foreground" data-testid="no-blanks">
          You have no blanks this round. Sit tight while the others finish!
        </p>
      )}

      {mine.map((b) => (
        <BlankCard key={b.recordId} blankId={b.recordId} blank={b.data} />
      ))}
    </div>
  )
}

function BlankCard({ blankId, blank }: { blankId: string; blank: BlankView }) {
  const { error } = useToast()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<'submit' | 'safety' | null>(null)
  const done = blank.filled === 1

  async function send(kind: 'submit' | 'safety') {
    setBusy(kind)
    const res =
      kind === 'submit'
        ? await callAction('submitBlank', { blankId, value })
        : await callAction('useSafetyWord', { blankId })
    setBusy(null)
    if (!res.success) error('Could not save', res.error)
  }

  return (
    <section className="jam-panel space-y-3 p-4 sm:p-5" data-testid="blank-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-extrabold">
          Give me <span data-testid="blank-label">{blank.label}</span>
        </h2>
        {done && <Badge variant="success">{blank.source === 'player' ? 'Done' : 'Safety word'}</Badge>}
      </div>

      {done ? (
        <p className="text-lg" data-testid="blank-value">
          {blank.value}
        </p>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send('submit')
            }}
          >
            <Input
              data-testid="blank-input"
              aria-label={`Your word: ${blank.label}`}
              value={value}
              maxLength={WORD_MAX_LENGTH}
              className="min-w-0"
              placeholder="Type something silly"
              onChange={(e) => setValue(e.target.value)}
            />
            <Button type="submit" data-testid="blank-submit" loading={busy === 'submit'} disabled={busy !== null || !value.trim()}>
              Submit
            </Button>
          </form>
          <Button
            variant="ghost"
            size="sm"
            data-testid="blank-safety"
            loading={busy === 'safety'}
            disabled={busy !== null}
            onClick={() => send('safety')}
          >
            Use a safety word
          </Button>
        </>
      )}
    </section>
  )
}
