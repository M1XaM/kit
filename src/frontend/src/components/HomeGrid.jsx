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
      <div className="header">
        <h1>Kit</h1>
        {headerSubtitle ? <p>{headerSubtitle}</p> : null}
      </div>

      {sections.map((section) => (
        <div className="category-section" key={section.id}>
          <h2 className="category-title">{section.title}</h2>
          <div className="grid">
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
