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

  return (
    <>
      <div className="status-bar">
        <div className="status-left">
          <p className="status-pill-link">
            Drag <a href="kit://start" className="underline text-current">Kit</a> to your bookmarks!
          </p>
          <a href="#" className="status-pill-link">
            Explore extension
            <span className="soon-badge">Soon</span>
          </a>
        </div>
        <div className="status-right">
          <a href="https://m1xam.github.io/kit/" className="status-pill-link">Landing page</a>
          <div className="status-connection-wrap">
            <div className="status-pill-link status-connection-pill">
              <span className={`status-dot ${status === 'Connected' ? 'connected' : 'disconnected'}`}></span>
              {status}
            </div>
            <div className="status-connection-tooltip">
              Local background server keeps running after you close this tab. Use the kit://start bookmark to reopen anytime.
            </div>
          </div>
        </div>
      </div>

      <div className={`page-content ${location.pathname === '/' ? 'page-content-home' : ''}`}>
        <div className="bg-glow" />
        <div className="bg-grid" />
      </div>
      <div className="container">
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
