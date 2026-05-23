import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { TOOLS } from './toolData'
import HomeGrid from './HomeGrid'
import ToolView from './ToolView'
import NotFound from './NotFound'
import Footer from './Footer'

function MainLayout({ headerSubtitle, footerRepoUrl, footerAuthorName }) {
  const [status, setStatus] = useState('Connecting...')
  const location = useLocation()
  const [favoriteOrder, setFavoriteOrder] = useState(() => {
    try {
      const stored = localStorage.getItem('kit-favorites')
      if (stored) {
        const order = JSON.parse(stored)
        const validIds = new Set(TOOLS.map((tool) => tool.id))
        return Array.isArray(order) ? order.filter((id) => typeof id === 'string' && validIds.has(id)) : []
      }
    } catch {}
    return []
  })

  const toggleFavorite = (toolID) => {
    setFavoriteOrder((current) => {
      const exists = current.includes(toolID)
      const nextOrder = exists
        ? current.filter((id) => id !== toolID)
        : [toolID, ...current.filter((id) => id !== toolID)]
      localStorage.setItem('kit-favorites', JSON.stringify(nextOrder))
      return nextOrder
    })
  }

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    let ws
    let interval
    let reconnectTimer
    let mounted = true

    function connect() {
      if (!mounted) return
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setStatus('Connected')
        interval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping')
          }
        }, 2000)
      }

      ws.onclose = () => {
        clearInterval(interval)
        if (!mounted) return
        setStatus('Disconnected')
        reconnectTimer = setTimeout(connect, 2000)
      }

      ws.onerror = (err) => {
        console.error('WebSocket error:', err)
      }
    }

    connect()

    return () => {
      mounted = false
      clearInterval(interval)
      clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }, [])

  const showFooter = location.pathname === '/'
  const pillClass = 'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-[0.95rem] text-blue-300 transition hover:border-white/20 hover:bg-white/10'
  const statusDotClass = status === 'Connected'
    ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.9)]'
    : 'bg-slate-500 shadow-[0_0_8px_rgba(100,116,139,0.6)]'

  return (
    <>
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-white/10 bg-black/80 px-6 py-2 text-sm text-slate-400 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <p className={pillClass}>
            Drag <a href="kit://start" className="underline decoration-slate-400 text-current">Kit</a> to your bookmarks!
          </p>
          <a href="#" className={pillClass}>
            Explore extension
            <span className="rounded-full border border-blue-400/50 bg-blue-600/30 px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide text-blue-200">Soon</span>
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a href="https://m1xam.github.io/kit/" className={pillClass}>Landing page</a>
          <div className="relative group">
            <div className={`${pillClass} cursor-default`}>
              <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${statusDotClass}`}></span>
              {status}
            </div>
            <div className="pointer-events-none absolute right-0 top-full mt-2 w-64 translate-y-1 rounded-lg border border-blue-400/40 bg-slate-950/95 p-3 text-xs text-blue-200 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
              Local background server keeps running after you close this tab. Use the kit://start bookmark to reopen anytime.
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-28 left-1/2 h-[520px] w-[min(1000px,90vw)] -translate-x-1/2 rounded-full bg-blue-500/15 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }}
        />
      </div>
      <div className="container mx-auto max-w-6xl px-5 pb-14 pt-12 relative z-10">
        <Routes>
          <Route
            path="/"
            element={
              <HomeGrid
                favoriteOrder={favoriteOrder}
                onToggleFavorite={toggleFavorite}
                headerSubtitle={headerSubtitle}
              />
            }
          />
          <Route path="/tool/:id" element={<ToolView />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        {showFooter && <Footer repoUrl={footerRepoUrl} authorName={footerAuthorName} />}
      </div>
    </>
  )
}

export default MainLayout
