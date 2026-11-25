import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { guarded } from '../server/game/helpers'
import { getNarration } from '../server/game/narration'
import {
  createGame,
  joinGame,
  retryPage,
  setStoryTheme,
  startGame,
  submitBlank,
  tick,
  useSafetyWord,
} from '../server/game/actions'

// `guarded` validates the request body shape and turns throws into clean errors.
export const actions: Record<string, ActionHandler<Env>> = {
  createGame: guarded(createGame),
  joinGame: guarded(joinGame),
  setStoryTheme: guarded(setStoryTheme),
  startGame: guarded(startGame),
  submitBlank: guarded(submitBlank),
  useSafetyWord: guarded(useSafetyWord),
  tick: guarded(tick),
  retryPage: guarded(retryPage),
  getNarration: guarded(getNarration),
}
