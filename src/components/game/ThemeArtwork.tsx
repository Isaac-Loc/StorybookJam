import { Leaf, Orbit, PartyPopper } from 'lucide-react'
import type { StoryThemeId } from '../../story-themes'

const icons = { silly: PartyPopper, space: Orbit, quest: Leaf }

export function ThemeArtwork({ theme }: { theme: StoryThemeId }) {
  const Icon = icons[theme]
  return (
    <div className="jam-theme-art" data-world={theme} aria-hidden>
      <span className="jam-theme-orbit" />
      <span className="jam-theme-symbol"><Icon strokeWidth={1.7} /></span>
    </div>
  )
}
