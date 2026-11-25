/**
 * Game collections.
 *
 * Design rule: clients NEVER write any of these. Every mutation goes through a
 * server action (src/server/game/), which runs with per-record RBAC off and
 * authorizes the caller itself. That is why every `create` below is false.
 *
 * `ownerField` columns are not marked `userBound` on purpose: SDK lint only
 * wants userBound to stop a client from creating a row with someone else's id,
 * and no client role can create rows here at all.
 */

import type { CollectionSchema, RolePermissions } from 'deepspace/schema'
import { GAME_PHASES, IMAGE_STATUSES } from '../game'

const NONE: RolePermissions = { read: false, create: false, update: false, delete: false }

const text = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, storage: 'text', interpretation: 'plain', ...extra }) as const
const num = (name: string, def = 0) =>
  ({ name, storage: 'number', interpretation: 'plain', default: def }) as const
const json = (name: string, def: unknown) =>
  ({ name, storage: 'text', interpretation: { kind: 'json' }, default: def }) as const

/** A room. Visible to its players only (host is the creator = owner). */
export const gamesSchema: CollectionSchema = {
  name: 'games',
  columns: [
    text('code', { required: true, immutable: true }),
    text('hostId'),
    {
      name: 'phase',
      storage: 'text',
      interpretation: { kind: 'select', options: [...GAME_PHASES] },
      default: 'lobby',
    },
    json('playerIds', []),
    json('playerNames', {}),
    num('phaseEndsAt'),
    num('expiresAt'), // epoch ms; room is dead from here on (see isExpired)
    num('filledCount'),
    num('totalBlanks'),
    text('title', { default: '' }),
  ],
  uniqueOn: ['code'],
  collaboratorsField: 'playerIds',
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: { read: 'shared', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

/** Server-maintained roster, the source of truth for who is in a room. */
export const membershipsSchema: CollectionSchema = {
  name: 'memberships',
  columns: [text('gameId'), text('userId'), text('name')],
  uniqueOn: ['gameId', 'userId'],
  ownerField: 'userId',
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

/**
 * One secret slot of the story. Only the assigned player may read it: the
 * Durable Object filters rows BEFORE broadcast, so other players' labels and
 * words never reach their browsers.
 *
 * Admins get 'own' too, NOT false. The SDK makes the app owner an admin
 * automatically, and the owner plays rounds like anyone else: with
 * `read: false` the owner's own blanks were invisible to them ("you have no
 * blanks this round"). 'own' keeps an admin out of other players' blanks while
 * letting them see the ones dealt to them.
 */
export const blanksSchema: CollectionSchema = {
  name: 'blanks',
  columns: [
    text('gameId'),
    num('idx'),
    text('label'),
    text('value', { default: '' }),
    num('filled'), // 0 | 1
    text('source', { default: '' }), // '' | 'player' | 'safety' | 'timeout'
    text('assignedTo'),
  ],
  uniqueOn: ['gameId', 'idx'],
  ownerField: 'assignedTo',
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}

/**
 * The story template + title for one game. Written by `startGame` (its
 * uniqueOn gameId doubles as the "start claimed" lock) and read only by server
 * actions, so no role can read it from a client.
 */
export const storyDraftsSchema: CollectionSchema = {
  name: 'storyDrafts',
  columns: [
    text('gameId'),
    text('title'),
    json('pages', []), // page TEXT templates with {0}..{5}
    json('labels', []), // 6 blank labels (also copied onto the blanks rows)
    json('safety', []), // 6 lists of safety words, one list per blank
    json('imagePrompts', []), // template image prompts (placeholders, never player text)
    json('finalPrompts', []), // moderated, player-word-filled prompts that fal actually sees
    text('source', { default: 'fixed' }), // 'model' | 'fixed'
  ],
  uniqueOn: ['gameId'],
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: NONE,
    admin: NONE,
  },
}

/** The finished story, one record per page. Created at reveal time. */
export const pagesSchema: CollectionSchema = {
  name: 'pages',
  columns: [
    text('gameId'),
    num('idx'),
    text('text'),
    text('imageUrl', { default: '' }),
    {
      name: 'imageStatus',
      storage: 'text',
      interpretation: { kind: 'select', options: [...IMAGE_STATUSES] },
      default: 'pending',
    },
    num('retries'), // manual retries used (max MAX_PAGE_RETRIES)
    json('playerIds', []), // copy of the game's players: what `shared` read checks
  ],
  uniqueOn: ['gameId', 'idx'],
  collaboratorsField: 'playerIds',
  permissions: {
    '*': NONE,
    viewer: NONE,
    member: { read: 'shared', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: true },
  },
}

/**
 * Append-only record of ESTIMATED generation spend (see budget.ts). Server
 * only: no role can read or write it, admin and app owner included. It is
 * deliberately NOT swept by room cleanup, so a room expiring never resets the
 * spend. uniqueOn (gameId, kind, ref) makes each reservation idempotent and
 * doubles as a once-per-game claim for the story and polish calls.
 */
export const spendLedgerSchema: CollectionSchema = {
  name: 'spendLedger',
  columns: [
    { name: 'kind', storage: 'text', interpretation: { kind: 'select', options: ['llm-story', 'llm-final', 'image'] } },
    num('credits'),
    text('gameId'),
    text('userId'), // the room's HOST, for the per-host sub-cap
    text('ref'),
  ],
  uniqueOn: ['gameId', 'kind', 'ref'],
  permissions: { '*': NONE, viewer: NONE, member: NONE, admin: NONE },
}

export const gameSchemas: CollectionSchema[] = [
  gamesSchema,
  membershipsSchema,
  blanksSchema,
  storyDraftsSchema,
  pagesSchema,
  spendLedgerSchema,
]
