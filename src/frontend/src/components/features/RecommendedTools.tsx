import { Link } from 'react-router-dom'
import { TOOLS, type Tool } from './toolData'

const MAX_RECOMMENDATIONS = 8

// pickRecommendations returns the tools most logically adjacent to the current
// one: same-category siblings first (the most relevant), then tools from other
// categories to fill out the row, capped at eight.
function pickRecommendations(currentId: string): Tool[] {
  const current = TOOLS.find((tool) => tool.id === currentId)
  if (!current) return []

  const others = TOOLS.filter((tool) => tool.id !== currentId && !tool.comingSoon)
  const sameCategory = others.filter((tool) => tool.category === current.category)
  const rest = others.filter((tool) => tool.category !== current.category)
  return [...sameCategory, ...rest].slice(0, MAX_RECOMMENDATIONS)
}

type RecommendedToolsProps = {
  currentId: string
}

function RecommendedTools({ currentId }: RecommendedToolsProps) {
  const recommendations = pickRecommendations(currentId)
  if (!recommendations.length) return null

  return (
    <div className="mx-auto mt-10 max-w-5xl">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Recommended next</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {recommendations.map((tool) => {
          const Icon = tool.icon
          return (
            <Link
              key={tool.id}
              to={`/tool/${tool.id}`}
              className="flex items-center gap-3 rounded-xl border p-3 transition border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tool.colorClass}`}>
                {Icon ? <Icon /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-100">{tool.title}</span>
                <span className="block truncate text-xs text-slate-400">{tool.description}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default RecommendedTools
