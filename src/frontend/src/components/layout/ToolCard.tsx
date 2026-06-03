import { useFavorites } from '../../state/favorites'
import type { Tool } from '../features/toolData'

type ToolCardProps = {
  tool: Tool
  onNavigate: (toolId: string) => void
}

function ToolCard({ tool, onNavigate }: ToolCardProps) {
  const { isFavorite, toggleFavorite } = useFavorites()
  const Icon = tool.icon
  const favorite = isFavorite(tool.id)
  const favoriteClass = favorite
    ? 'border-amber-300 bg-amber-100 text-amber-600 dark:border-amber-400/70 dark:bg-amber-400/20 dark:text-amber-300'
    : 'border-slate-300 bg-slate-50 text-slate-400 dark:border-white/20 dark:bg-white/5 dark:text-slate-500'

  return (
    <div
      className="relative flex h-full min-h-[240px] cursor-pointer flex-col rounded-2xl border p-5 transition hover:-translate-y-0.5 border-slate-300 bg-white shadow-md hover:border-slate-300 hover:shadow-lg dark:border-white/10 dark:bg-white/5 dark:backdrop-blur dark:shadow-none dark:hover:border-white/20 dark:hover:bg-white/10"
      onClick={() => onNavigate(tool.id)}
    >
      <div className="absolute right-3 top-3 flex items-center gap-2">
        {tool.comingSoon && (
          <button
            type="button"
            className="rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold tracking-wide border-blue-200 bg-blue-100 text-blue-700 dark:border-blue-400/50 dark:bg-blue-600/30 dark:text-blue-200"
            aria-label={`${tool.title} is coming soon`}
            title="Coming soon"
            onClick={(event) => {
              event.stopPropagation()
              onNavigate(tool.id)
            }}
          >
            Soon
          </button>
        )}
        <button
          type="button"
          className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition hover:border-amber-400/60 hover:bg-amber-400/20 hover:text-amber-300 ${favoriteClass}`}
          aria-label={favorite ? `Remove ${tool.title} from favorites` : `Add ${tool.title} to favorites`}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(event) => {
            event.stopPropagation()
            toggleFavorite(tool.id)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </button>
      </div>
      <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${tool.colorClass}`}>
        {Icon ? <Icon /> : null}
      </div>
      <h3 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-50">{tool.title}</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">{tool.description}</p>
    </div>
  )
}

export default ToolCard
