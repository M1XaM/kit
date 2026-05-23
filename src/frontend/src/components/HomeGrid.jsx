import { useNavigate } from 'react-router-dom'
import ToolCard from './ToolCard'
import { CATEGORY_SECTIONS, TOOLS } from './toolData'

function HomeGrid({ favoriteOrder, onToggleFavorite, headerSubtitle }) {
  const navigate = useNavigate()
  const toolMap = new Map(TOOLS.map((tool) => [tool.id, tool]))
  const favoriteTools = favoriteOrder.map((id) => toolMap.get(id)).filter(Boolean)
  const favoriteSet = new Set(favoriteTools.map((tool) => tool.id))
  const sections = []

  if (favoriteTools.length) {
    sections.push({
      id: 'favorites',
      title: 'Favorites',
      tools: favoriteTools
    })
  }

  CATEGORY_SECTIONS.forEach((section) => {
    const tools = section.toolIds
      .map((id) => toolMap.get(id))
      .filter(Boolean)
      .filter((tool) => !favoriteSet.has(tool.id))

    if (tools.length) {
      sections.push({
        id: section.id,
        title: section.title,
        tools
      })
    }
  })

  return (
    <>
      <div className="text-center mb-16">
        <h1 className="text-[clamp(3rem,11vw,6.75rem)] font-extrabold tracking-[-0.04em] leading-none bg-gradient-to-b from-white via-white to-slate-500 bg-clip-text text-transparent">
          Kit
        </h1>
        {headerSubtitle ? (
          <p className="mx-auto mt-5 max-w-2xl text-[clamp(1rem,2vw,1.35rem)] text-slate-400 leading-relaxed">
            {headerSubtitle}
          </p>
        ) : null}
      </div>

      {sections.map((section) => (
        <div className="mb-12 last:mb-0" key={section.id}>
          <h2 className="mb-4 text-[clamp(1.35rem,2.6vw,1.8rem)] font-extrabold tracking-[0.06em] text-slate-50">
            {section.title}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4 text-left">
            {section.tools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                isFavorite={favoriteSet.has(tool.id)}
                onToggleFavorite={onToggleFavorite}
                onNavigate={(toolId) => navigate('/tool/' + toolId)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export default HomeGrid
