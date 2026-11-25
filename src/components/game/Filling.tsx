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
import { Check } from 'lucide-react'
import { Badge, Button, Input, useToast } from '@/components/ui'
import { useQuery } from 'deepspace'
import { callAction } from '@/lib/callAction'
import { WORD_MAX_LENGTH } from '../../game'
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

  return (
    <div className="mx-auto max-w-lg space-y-6 px-6 py-10">
      <ul aria-label="Player progress" className="flex flex-wrap justify-center gap-2" data-testid="player-progress">
        {game.playerIds.map((id) => {
          const finished = game.finishedPlayerIds?.includes(id) ?? false
          return (
            <li key={id} data-finished={finished} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm">
              {game.playerNames[id] ?? 'Player'}
              {finished && <Check aria-hidden="true" className="size-4 text-green-600 dark:text-green-400" />}
              <span className="sr-only">: {finished ? 'Finished' : 'Still filling words'}</span>
            </li>
          )
        })}
      </ul>
      <header className="text-center">
        <p className="font-mono text-5xl font-bold tabular-nums" data-testid="countdown">
          {mm}:{ss}
        </p>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="progress">
          {game.filledCount} of {game.totalBlanks} blanks filled
        </p>
        {expired && <p className="mt-1 text-sm text-warning">Time is up! Finishing the story...</p>}
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
    <section className="space-y-3 rounded-lg border border-border bg-card p-5" data-testid="blank-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">
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
