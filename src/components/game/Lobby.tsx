/** Lobby phase: room code, live player list, host-only Start button. */

import { useState } from 'react'
import { ArrowRight, Check, Copy, Users } from 'lucide-react'
import { Badge, Button, useToast } from '@/components/ui'
import { callAction } from '@/lib/callAction'
import { MAX_PLAYERS, MIN_PLAYERS } from '../../game'
import { getStoryTheme, STORY_THEMES, type StoryThemeId } from '../../story-themes'
import { ThemeArtwork } from './ThemeArtwork'
import type { GameView } from './types'

export function Lobby({ gameId, game, myId }: { gameId: string; game: GameView; myId: string | null }) {
  const { error, success } = useToast()
  const [starting, setStarting] = useState(false)
  const [savingTheme, setSavingTheme] = useState(false)
  const [choice, setChoice] = useState<{ previous: StoryThemeId; next: StoryThemeId } | null>(null)
  const [copied, setCopied] = useState(false)
  const isHost = myId === game.hostId
  const canStart = isHost && game.playerIds.length >= MIN_PLAYERS
  const saved = getStoryTheme(game.lobbyTheme).id
  if (choice && choice.previous !== saved) setChoice(null)
  const theme = getStoryTheme(choice?.previous === saved ? choice.next : saved)

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
    const res = await callAction('startGame', { gameId, theme: theme.id })
    setStarting(false)
    if (!res.success) return error('Could not start', res.error)
    success('Game started!')
  }

  async function choose(next: StoryThemeId) {
    setChoice({ previous: saved, next })
    setSavingTheme(true)
    const res = await callAction('setStoryTheme', { gameId, theme: next })
    setSavingTheme(false)
    if (!res.success) {
      setChoice(null)
      error('Could not choose theme', res.error)
    }
  }

  return (
    <div className="jam-room jam-container max-w-5xl py-8 sm:py-14" data-world={theme.id}>
      <header className="mb-7">
        <h1 className="jam-display">The writing room.</h1>
        <p className="mt-2 text-base text-muted-foreground">Invite friends, or start a solo story.</p>
      </header>
      <div className="grid items-start gap-5 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-7">
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-1">
          <section className="jam-ticket px-4 py-4 text-center">
            <h2 className="text-xs font-extrabold tracking-widest uppercase">Room code</h2>
            <p className="mt-1 font-mono text-[clamp(1.65rem,7vw,2.6rem)] font-black tracking-[.15em]" data-testid="room-code">{game.code}</p>
            <Button variant="outline" size="sm" className="mt-2 bg-white/80" onClick={copyLink} data-testid="copy-link">
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied!' : 'Copy invite link'}
            </Button>
          </section>

          <section className="jam-panel p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <Users size={17} aria-hidden /> Players ({game.playerIds.length}/{MAX_PLAYERS})
            </h2>
            <ul className="divide-y divide-border" data-testid="player-list">
              {game.playerIds.map((id) => (
                <li key={id} className="flex min-w-0 items-center justify-between gap-2 py-2 text-sm" data-testid="player-row">
                  <span className="min-w-0 break-words font-semibold">{game.playerNames[id] ?? 'Player'}</span>
                  {id === game.hostId && <Badge variant="secondary">Host</Badge>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="jam-panel p-4 sm:p-6">
          {isHost ? (
            <fieldset disabled={savingTheme || starting}>
              <legend className="mb-3 text-xl font-extrabold tracking-tight">Pick a story theme</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {STORY_THEMES.map((option) => (
                  <label key={option.id} className="jam-theme-choice" data-world={option.id}>
                    <input type="radio" name="story-theme" className="sr-only" checked={option.id === theme.id} onChange={() => void choose(option.id)} />
                    <ThemeArtwork theme={option.id} />
                    <span className="flex items-center justify-between gap-1 px-3 pt-2.5 font-bold">
                      {option.name}{option.id === theme.id && <Check size={16} className="shrink-0" aria-hidden />}
                    </span>
                    <span className="block px-3 pt-1 pb-3 text-xs text-muted-foreground">{option.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <div data-testid="selected-story-theme" aria-live="polite">
              <h2 className="mb-3 text-xl font-extrabold tracking-tight">The host picked {theme.name}</h2>
              <div className="overflow-hidden rounded-xl"><ThemeArtwork theme={theme.id} /></div>
              <p className="mt-2 text-muted-foreground">{theme.description}</p>
            </div>
          )}
          {isHost ? (
            <Button size="lg" className="mt-5 w-full sm:w-auto" data-testid="start-game" loading={starting} disabled={!canStart || savingTheme} onClick={start}>
              {starting ? 'Writing your story...' : 'Start the story'} <ArrowRight aria-hidden />
            </Button>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground" data-testid="waiting-for-host">
              Waiting for the host to start...
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
