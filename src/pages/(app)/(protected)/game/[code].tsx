/**
 * /game/<CODE>: one page that renders whichever phase the room is in.
 *
 * The `games` collection is readable only by the room's players, so an empty
 * result means "no such room OR you are not in it yet" and we offer to join.
 */

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth, useQuery } from 'deepspace'
import { Filling } from '@/components/game/Filling'
import { JoinRoom } from '@/components/game/JoinRoom'
import { Lobby } from '@/components/game/Lobby'
import { Revealed } from '@/components/game/Revealed'
import type { GameView } from '@/components/game/types'
import { isExpired, normalizeCode } from '../../../../game'

/** Re-render periodically so a room that expires while the page is open flips to the expired state. */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export default function GamePage() {
  const now = useNow(15_000)
  const code = normalizeCode(useParams().code ?? '')
  const { userId } = useAuth()
  const { records, status, error } = useQuery<GameView>('games', { where: { code }, limit: 1 })
  const game = records[0]

  if (status === 'loading') {
    return <p className="py-16 text-center text-muted-foreground">Loading room {code}...</p>
  }
  if (status === 'error') {
    return <p className="py-16 text-center text-destructive">Could not load the room: {error ?? 'unknown error'}</p>
  }
  if (!game) return <JoinRoom code={code} />
  // Checked before any phase component renders, so an expired room never
  // mounts Filling (and its tick loop). The server refuses expired rooms too.
  if (isExpired(game.data, now)) {
    return (
      <div className="jam-panel jam-container mt-10 max-w-md space-y-4 p-6 text-center sm:mt-16" data-testid="room-expired">
        <h1 className="jam-display">This room has expired.</h1>
        <p className="text-muted-foreground">Rooms last 2 hours. Start a new one and play again!</p>
        <Link to="/home" className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Back home
        </Link>
      </div>
    )
  }

  const { phase } = game.data
  if (phase === 'lobby') return <Lobby gameId={game.recordId} game={game.data} myId={userId} />
  if (phase === 'filling') return <Filling gameId={game.recordId} game={game.data} />
  // generating / ready (and the legacy 'revealed') all show the story; the
  // illustrations fill in live while the phase is 'generating'.
  if (phase === 'generating' || phase === 'ready' || phase === 'revealed') {
    return <Revealed gameId={game.recordId} title={game.data.title} phase={phase} storyTheme={game.data.storyTheme} pageCount={game.data.pageCount} />
  }

  return <p className="py-16 text-center text-muted-foreground">Something went wrong with this room ({phase}).</p>
}
