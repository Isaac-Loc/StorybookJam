/**
 * Signed-in home: pick a display name, then create a room or join one by code.
 * Both paths call a server action and navigate to /game/<CODE>.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from 'deepspace'
import { Button, Input, Label, useToast } from '@/components/ui'
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
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-6 py-12 text-foreground">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">StorybookJam</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everyone fills in a few secret blanks. Then the whole silly story is revealed.
        </p>
      </header>

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

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold">Host a room</h2>
        <Button
          className="w-full"
          data-testid="create-room"
          loading={busy === 'create'}
          disabled={busy !== null}
          onClick={() => run('create')}
        >
          Create a room
        </Button>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <h2 className="font-semibold">Join with a code</h2>
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
            className="font-mono uppercase tracking-widest"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
          />
          <Button
            type="submit"
            variant="secondary"
            data-testid="join-room"
            loading={busy === 'join'}
            disabled={busy !== null || code.length !== CODE_LENGTH}
          >
            Join
          </Button>
        </form>
      </section>
    </div>
  )
}
