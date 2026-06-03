import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Footer from './Footer'
import HomeGrid from './HomeGrid'
import NotFound from './NotFound'
import ToolView from '../features/ToolView'
import { FavoritesProvider } from '../../state/favorites'

const FOOTER_REPO_URL = 'https://github.com/M1XaM/kit'
const FOOTER_AUTHOR_NAME = 'Isacescu Maxim'

type HeaderBarProps = {
  status: string
}

function HeaderBar({ status }: HeaderBarProps) {
  const pillClass = 'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[0.95rem] transition border-white/10 bg-white/5 text-blue-300 hover:border-white/20 hover:bg-white/10'
  const statusDotClass = status === 'Connected'
    ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.9)] animate-pulse'
    : 'bg-slate-500 shadow-[0_0_8px_rgba(100,116,139,0.6)]'
  const soonBadgeClass = 'rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide border-blue-400/50 bg-blue-600/30 text-blue-200'
  const tooltipClass = 'border-blue-400/40 bg-slate-950/95 text-blue-200'

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-2 border-b px-6 py-2 text-sm backdrop-blur md:flex-row md:items-center md:justify-between border-white/10 bg-black/80 text-slate-400">
      <div className="flex flex-wrap items-center gap-3">
        <p className={pillClass}>
          Drag <a href="kit://start" className="underline decoration-slate-400 text-current">Kit</a> to your bookmarks!
        </p>
        <a href="#" className={pillClass}>
          Explore extension
          <span className={soonBadgeClass}>Soon</span>
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative group">
          <div className={`${pillClass} cursor-default`}>
            <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${statusDotClass}`}></span>
            {status}
          </div>
          <div className={`pointer-events-none absolute right-0 top-full mt-2 w-64 translate-y-1 rounded-lg border p-3 text-xs opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100 ${tooltipClass}`}>
            Local background server keeps running after you close this tab. Use the kit://start bookmark to reopen anytime.
          </div>
        </div>
      </div>
    </div>
  )
}

function AppLayout() {
  const location = useLocation()
  const [status, setStatus] = useState('Connecting...')

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    let ws: WebSocket | null = null
    let interval: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let mounted = true

    function connect() {
      if (!mounted) return
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setStatus('Connected')
        interval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('ping')
          }
        }, 2000)
      }

      ws.onclose = () => {
        if (interval) clearInterval(interval)
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
      if (interval) clearInterval(interval)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }, [])

  const showFooter = location.pathname === '/'
  const gridColor = 'rgba(255,255,255,0.02)'

  return (
    <div className="relative min-h-screen flex flex-col">
      <HeaderBar status={status} />

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-28 left-1/2 h-[520px] w-[min(1000px,90vw)] -translate-x-1/2 rounded-full bg-blue-500/15 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }}
        />
      </div>

      <main className="relative z-10 flex-1 flex flex-col">
        <div className="container mx-auto max-w-6xl px-5 pb-10 pt-12 flex-1">
          <FavoritesProvider>
            <Routes>
              <Route path="/" element={<HomeGrid />} />
              <Route path="/tool/:id" element={<ToolView />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </FavoritesProvider>
        </div>

        {showFooter && (
          <div className="container mx-auto max-w-6xl px-5 pb-8 mt-auto">
            <Footer repoUrl={FOOTER_REPO_URL} authorName={FOOTER_AUTHOR_NAME} />
          </div>
        )}
      </main>
    </div>
  )
}

export default AppLayout
