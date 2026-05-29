import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { TOOLS } from '../components/features/toolData'

const FAVORITES_STORAGE_KEY = 'kit-favorites'

type FavoritesContextValue = {
  favoriteOrder: string[]
  favoriteSet: Set<string>
  isFavorite: (id: string) => boolean
  toggleFavorite: (id: string) => void
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined)

const getInitialFavorites = () => {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (stored) {
      const order = JSON.parse(stored)
      const validIds = new Set(TOOLS.map((tool) => tool.id))
      return Array.isArray(order) ? order.filter((id) => typeof id === 'string' && validIds.has(id)) : []
    }
  } catch {}
  return []
}

type FavoritesProviderProps = {
  children: React.ReactNode
}

export function FavoritesProvider({ children }: FavoritesProviderProps) {
  const [favoriteOrder, setFavoriteOrder] = useState<string[]>(getInitialFavorites)

  const toggleFavorite = useCallback((toolID: string) => {
    setFavoriteOrder((current) => {
      const exists = current.includes(toolID)
      const nextOrder = exists
        ? current.filter((id) => id !== toolID)
        : [toolID, ...current.filter((id) => id !== toolID)]
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(nextOrder))
      return nextOrder
    })
  }, [])

  const favoriteSet = useMemo(() => new Set(favoriteOrder), [favoriteOrder])
  const isFavorite = useCallback((id: string) => favoriteSet.has(id), [favoriteSet])

  const value = useMemo(() => ({
    favoriteOrder,
    favoriteSet,
    isFavorite,
    toggleFavorite
  }), [favoriteOrder, favoriteSet, isFavorite, toggleFavorite])

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

export function useFavorites() {
  const context = useContext(FavoritesContext)
  if (!context) {
    throw new Error('useFavorites must be used within a FavoritesProvider')
  }
  return context
}
