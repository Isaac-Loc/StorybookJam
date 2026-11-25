import { Leaf, Orbit, PartyPopper } from 'lucide-react'
import type { StoryThemeId } from '../../story-themes'

const icons = { silly: PartyPopper, space: Orbit, quest: Leaf }

export function ThemeArtwork({ theme, placeholder = false }: { theme: StoryThemeId; placeholder?: boolean }) {
  const Icon = icons[theme]
  return (
    <div className="jam-theme-art" data-world={theme} aria-hidden>
      {placeholder ? (
        <>
          <span className="jam-theme-orbit" />
          <span className="jam-theme-symbol"><Icon strokeWidth={1.7} /></span>
        </>
      ) : (
        <img src={`/story-art/cover-${theme}.jpg`} alt="" width={960} height={720} loading="lazy" decoding="async" />
      )}
    </div>
  )
}
