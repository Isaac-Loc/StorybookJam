/**
 * Shown when /game/<CODE> matches no game this user can see: either the room
 * does not exist, or they are not in it yet (the records are private to
 * players). A shared link therefore lands here and lets them join.
 */

import { useEffect, useState } from 'react'
import { useUser } from 'deepspace'
import { Button, Input, Label, useToast } from '@/components/ui'
import { callAction } from '@/lib/callAction'
import { NAME_MAX_LENGTH, cleanName } from '../../game'

/** How long to wait for the game record to arrive after a successful join. */
const JOIN_WAIT_MS = 10_000

export function JoinRoom({ code }: { code: string }) {
  const { error } = useToast()
  const { user } = useUser()
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? (user?.name ?? '').slice(0, NAME_MAX_LENGTH)
  const [busy, setBusy] = useState(false)
  // After a successful join the game record arrives over the WebSocket a
  // moment later; until then show a waiting state rather than the form again.
  const [joined, setJoined] = useState(false)
  const [stalled, setStalled] = useState(false)

  async function join() {
    if (!cleanName(name)) return error('Pick a display name', `1 to ${NAME_MAX_LENGTH} characters.`)
    setBusy(true)
    const res = await callAction('joinGame', { code, name })
    setBusy(false)
    if (!res.success) return error('Could not join', res.error)
    setJoined(true)
  }

  // If the game record never shows up (e.g. the roster sync failed server
  // side), stop waiting after a while and offer a retry. joinGame is
  // idempotent for existing members and re-syncs the roster.
  useEffect(() => {
    if (!joined || stalled) return
    const t = setTimeout(() => setStalled(true), JOIN_WAIT_MS)
    return () => clearTimeout(t)
  }, [joined, stalled])

  if (joined && !stalled) {
    return <p className="py-16 text-center text-muted-foreground">Joining room {code}...</p>
  }
  if (joined && stalled) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-6 py-16 text-center" data-testid="join-stalled">
        <p>This is taking longer than expected. You may be in the room but it has not loaded yet.</p>
        <Button
          loading={busy}
          data-testid="join-retry"
          onClick={async () => {
            setBusy(true)
            const res = await callAction('joinGame', { code, name })
            setBusy(false)
            if (!res.success) {
              setJoined(false) // back to the form with the reason shown
              setStalled(false)
              return error('Could not join', res.error)
            }
            setStalled(false) // wait another round for the room to load
          }}
        >
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-6 py-16">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Join this room</h1>
        <p className="mt-1 font-mono text-lg tracking-widest text-muted-foreground" data-testid="join-room-code">
          {code}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="join-name">Your name</Label>
        <Input
          id="join-name"
          data-testid="join-name"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void join()}
        />
      </div>
      <Button className="w-full" data-testid="join-submit" loading={busy} onClick={join}>
        Join this room
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        If nothing happens, the room may not exist, may be full, or may have already started.
      </p>
    </div>
  )
}
