import { BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Brand() {
  return (
    <Link to="/" className="jam-brand" aria-label="StorybookJam home">
      <span className="jam-brand-icon"><BookOpen size={19} strokeWidth={2.5} aria-hidden /></span>
      <span>Storybook<span className="jam-brand-accent">Jam</span></span>
    </Link>
  )
}
