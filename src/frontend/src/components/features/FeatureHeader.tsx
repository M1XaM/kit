import type { ReactNode } from 'react'
import { useFavorites } from '../../state/favorites'
import RuntimePill from './RuntimePill'
import type { Tool } from './toolData'

type FeatureHeaderProps = {
  tool: Tool
  subtitle?: string
  rightSlot?: ReactNode
}

function FeatureHeader({ tool, subtitle, rightSlot }: FeatureHeaderProps) {
  const { isFavorite, toggleFavorite } = useFavorites()
  const Icon = tool.icon
  const favorite = isFavorite(tool.id)
  const favoriteClass = favorite
    ? 'border-amber-400/70 bg-amber-400/20 text-amber-300'
    : 'border-white/20 bg-white/5 text-slate-500'

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${tool.colorClass}`}>
          {Icon ? <Icon /> : null}
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-slate-50">{tool.title}</h2>
          <p className="text-sm text-slate-400">{subtitle || tool.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <RuntimePill tool={tool} />
        {rightSlot}
        <button
          type="button"
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:border-amber-400/60 hover:bg-amber-400/20 hover:text-amber-300 ${favoriteClass}`}
          aria-label={favorite ? `Remove ${tool.title} from favorites` : `Add ${tool.title} to favorites`}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => toggleFavorite(tool.id)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default FeatureHeader
