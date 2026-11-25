/**
 * Client-side views of the game records (what `useQuery` returns under `.data`).
 * Server-side shapes live in src/server/game/helpers.ts; kept separate so the
 * browser bundle never imports Worker code.
 */

import type { GamePhase, NarrationStatus } from '../../game'
import type { StoryThemeId } from '../../story-themes'

export type GameView = {
  code: string
  hostId: string
  phase: GamePhase
  lobbyTheme?: StoryThemeId
  storyTheme?: StoryThemeId
  playerIds: string[]
  playerNames: Record<string, string>
  phaseEndsAt: number
  expiresAt: number
  filledCount: number
  finishedPlayerIds?: string[]
  totalBlanks: number
  title: string
}

export type BlankView = {
  gameId: string
  idx: number
  label: string
  value: string
  filled: number
  source: string
  assignedTo: string
}

export type PageView = {
  gameId: string
  idx: number
  text: string
  imageUrl: string
  imageStatus: 'pending' | 'generating' | 'ready' | 'failed' | 'skipped'
  narrationStatus?: NarrationStatus
  retries: number
}
