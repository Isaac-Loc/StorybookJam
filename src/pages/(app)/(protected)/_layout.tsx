/**
 * Gated routes. Any file under src/pages/(app)/(protected)/ requires sign-in.
 * The `(protected)` folder is a Generouted route group — parentheses mean
 * it doesn't appear in the URL. For a dynamic page that does NOT require
 * sign-in, put it directly under src/pages/(app)/; for a static page, put it
 * at the top level of src/pages/.
 *
 * Children may call data hooks like `useUser()` safely because the parent
 * (app)/_layout.tsx mounts <RecordProvider> above this layout.
 *
 * The `fallback` keeps signed-out visitors inside the app's own chrome
 * (without it, AuthGate shows the SDK's full-screen, non-dismissible
 * overlay). The sign-in overlay opens on demand and can be dismissed.
 */

import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { AuthGate, AuthOverlay } from 'deepspace'
import { Button } from '@/components/ui'
import { ThemeArtwork } from '@/components/game/ThemeArtwork'

export default function ProtectedLayout() {
  return (
    <AuthGate fallback={<SignedOutPanel />}>
      <Outlet />
    </AuthGate>
  )
}

function SignedOutPanel() {
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <div className="jam-container flex min-h-[65vh] items-center justify-center py-10">
      <div className="jam-panel grid w-full max-w-4xl overflow-hidden sm:grid-cols-2">
        <ThemeArtwork theme="silly" />
        <div className="flex flex-col items-start justify-center p-6 sm:p-8">
          <h1 className="jam-display">Sign in to play.</h1>
          <p className="mt-3 text-base text-muted-foreground">Sign in to host a story or join your friends’ room.</p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <Button onClick={() => setShowAuthModal(true)}>Sign in</Button>
            <Link to="/" className="jam-text-link">Back to home</Link>
          </div>
        </div>
      </div>

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
