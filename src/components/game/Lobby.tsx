/** Lobby phase: room code, live player list, host-only Start button. */

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Badge, Button, useToast } from '@/components/ui'
import { callAction } from '@/lib/callAction'
import { BLANK_COUNT, MAX_PLAYERS, MIN_PLAYERS } from '../../game'
import type { GameView } from './types'

export function Lobby({ gameId, game, myId }: { gameId: string; game: GameView; myId: string | null }) {
  const { error, success } = useToast()
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const isHost = myId === game.hostId
  const canStart = isHost && game.playerIds.length >= MIN_PLAYERS

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/game/${game.code}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      error('Could not copy', 'Copy the room code instead.')
    }
  }

  async function start() {
    setStarting(true)
    const res = await callAction('startGame', { gameId })
    setStarting(false)
    if (!res.success) return error('Could not start', res.error)
    success('Game started!')
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 px-6 py-12 text-center">
      <section>
        <p className="text-sm uppercase tracking-widest text-muted-foreground">Room code</p>
        <p className="mt-2 font-mono text-6xl font-bold tracking-[0.2em]" data-testid="room-code">
          {game.code}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={copyLink} data-testid="copy-link">
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied!' : 'Copy invite link'}
        </Button>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 text-left">
        <h2 className="mb-3 font-semibold">
          Players ({game.playerIds.length}/{MAX_PLAYERS})
        </h2>
        <ul className="space-y-2" data-testid="player-list">
          {game.playerIds.map((id) => (
            <li key={id} className="flex items-center justify-between text-sm" data-testid="player-row">
              <span>{game.playerNames[id] ?? 'Player'}</span>
              {id === game.hostId && <Badge variant="secondary">Host</Badge>}
            </li>
          ))}
        </ul>
      </section>

      {isHost ? (
        <Button size="lg" className="w-full" data-testid="start-game" loading={starting} disabled={!canStart} onClick={start}>
          {starting ? 'Writing your story...' : 'Start the story'}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="waiting-for-host">
          Waiting for the host to start...
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        The story has {BLANK_COUNT} blanks. The fewer players, the more blanks each person fills in.
      </p>
    </div>
  )
}
