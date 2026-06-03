import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ToolCard from './ToolCard'
import { CATEGORY_SECTIONS, TOOLS, type Tool } from '../features/toolData'
import { useFavorites } from '../../state/favorites'

type ToolSection = {
  id: string
  title: string
  tools: Tool[]
}

function HomeGrid() {
  const navigate = useNavigate()
  const { favoriteOrder } = useFavorites()
  const [searchQuery, setSearchQuery] = useState('')
  const toolMap = new Map(TOOLS.map((tool) => [tool.id, tool]))
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const matchesQuery = (tool: Tool) => {
    if (!normalizedQuery) return true
    return tool.title.toLowerCase().includes(normalizedQuery) || tool.description.toLowerCase().includes(normalizedQuery)
  }
  const favoriteTools = favoriteOrder.map((id) => toolMap.get(id)).filter(Boolean).filter(matchesQuery)
  const sections: ToolSection[] = []

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
      .filter(matchesQuery)

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
        <h1 className="text-[clamp(3rem,11vw,6.75rem)] font-extrabold tracking-[-0.04em] leading-none bg-gradient-to-b bg-clip-text text-transparent from-slate-900 via-slate-800 to-slate-400 dark:from-white dark:via-white dark:to-slate-500">
          Kit
        </h1>
        <div className="mx-auto mt-6 max-w-2xl">
          <label className="sr-only" htmlFor="tool-search">Search tools</label>
          <div className="relative">
            <input
              id="tool-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by any keyword"
              className="w-full rounded-full border px-5 py-3 text-sm transition focus:outline-none focus:ring-2 border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-blue-400 focus:ring-blue-400/30 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:placeholder:text-slate-500 dark:shadow-none dark:focus:border-blue-400/50"
            />
            {searchQuery ? (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border px-3 py-1 text-[0.7rem] font-semibold transition border-slate-300 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-slate-200 dark:border-white/10 dark:bg-white/10 dark:text-slate-200 dark:hover:border-white/20 dark:hover:bg-white/20"
                onClick={() => setSearchQuery('')}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {sections.length ? (
        sections.map((section) => (
          <div className="mb-12 last:mb-0" key={section.id}>
            <h2 className="mb-4 text-[clamp(1.35rem,2.6vw,1.8rem)] font-extrabold tracking-[0.06em] text-slate-900 dark:text-slate-50">
              {section.title}
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4 text-left auto-rows-fr items-stretch">
              {section.tools.map((tool) => (
                <ToolCard
                  key={tool.id}
                  tool={tool}
                  onNavigate={(toolId) => navigate('/tool/' + toolId)}
                />
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-2xl border p-8 text-center text-sm border-slate-300 bg-white text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:shadow-none">
          No tools match that search. Try a different keyword.
        </div>
      )}
    </>
  )
}

export default HomeGrid
