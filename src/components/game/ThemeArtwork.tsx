import { Leaf, Orbit, PartyPopper } from 'lucide-react'
import type { StoryThemeId } from '../../story-themes'

const icons = { silly: PartyPopper, space: Orbit, quest: Leaf }

export function ThemeArtwork({ theme, decorativeOnly = false }: { theme: StoryThemeId; decorativeOnly?: boolean }) {
  const Icon = icons[theme]
  return (
    <div className="jam-theme-art" data-world={theme} aria-hidden>
      {theme === 'silly' && !decorativeOnly && (
        <img src="/sample/page-1.jpg" alt="" width={768} height={576} decoding="async" loading="lazy" />
      )}
      <span className="jam-theme-orbit" />
      <span className="jam-theme-symbol"><Icon strokeWidth={1.7} /></span>
    </div>
  )
}
