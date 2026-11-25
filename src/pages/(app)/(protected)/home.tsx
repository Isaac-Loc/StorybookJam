/**
 * Signed-in home: pick a display name, then create a room or join one by code.
 * Both paths call a server action and navigate to /game/<CODE>.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from 'deepspace'
import { ArrowRight, Plus, Ticket } from 'lucide-react'
import { Button, Input, Label, useToast } from '@/components/ui'
import { ThemeArtwork } from '@/components/game/ThemeArtwork'
import { callAction } from '@/lib/callAction'
import { CODE_LENGTH, NAME_MAX_LENGTH, cleanName, normalizeCode } from '../../../game'

type JoinOrCreateResult = { gameId: string; code: string }

export default function HomePage() {
  const navigate = useNavigate()
  const { error } = useToast()
  const { user } = useUser()

  // `typed` is null until the player edits the field, so the signed-in name
  // can prefill without an effect (and without clobbering what they type).
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? (user?.name ?? '').slice(0, NAME_MAX_LENGTH)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)

  const validName = cleanName(name) !== null

  async function run(kind: 'create' | 'join') {
    if (!validName) return error('Pick a display name', `1 to ${NAME_MAX_LENGTH} characters.`)
    setBusy(kind)
    const res = await callAction<JoinOrCreateResult>(kind === 'create' ? 'createGame' : 'joinGame', {
      name,
      code,
    })
    setBusy(null)
    if (!res.success) return error(kind === 'create' ? 'Could not create room' : 'Could not join', res.error)
    navigate(`/game/${res.data.code}`)
  }

  return (
    <div className="jam-container grid max-w-5xl items-start gap-6 py-8 sm:py-14 lg:grid-cols-[.8fr_1fr] lg:gap-9">
      <header className="jam-stage overflow-hidden" data-world="silly">
        <ThemeArtwork theme="silly" />
        <div className="p-5 sm:p-7">
          <h1 className="jam-display">Let’s make a story.</h1>
          <p className="mt-3 text-base text-muted-foreground">
            Host a room for friends, play solo, or join a room with a code.
          </p>
        </div>
      </header>

      <div className="jam-panel grid gap-5 p-5 sm:p-7">
        <section className="space-y-2">
          <Label htmlFor="display-name">Your name</Label>
          <Input
            id="display-name"
            data-testid="display-name"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            placeholder="What should we call you?"
            onChange={(e) => setTyped(e.target.value)}
          />
        </section>

        <section className="grid gap-3 rounded-xl bg-secondary p-4">
          <h2 className="flex items-center gap-2 text-base font-extrabold"><Plus size={19} aria-hidden /> Host a room</h2>
          <Button data-testid="create-room" loading={busy === 'create'} disabled={busy !== null} onClick={() => run('create')}>
            Create a room <ArrowRight aria-hidden />
          </Button>
        </section>

        <section className="grid gap-3 rounded-xl border border-border p-4">
          <h2 className="flex items-center gap-2 text-base font-extrabold"><Ticket size={19} aria-hidden /> Join with a code</h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void run('join')
            }}
          >
            <Input
              data-testid="join-code"
              aria-label="Room code"
              value={code}
              maxLength={CODE_LENGTH + 4}
              placeholder="ABCDE"
              className="min-w-0 font-mono uppercase tracking-widest"
              onChange={(e) => setCode(normalizeCode(e.target.value))}
            />
            <Button type="submit" variant="secondary" data-testid="join-room" loading={busy === 'join'} disabled={busy !== null || code.length !== CODE_LENGTH}>Join</Button>
          </form>
        </section>
      </div>
    </div>
  )
}
