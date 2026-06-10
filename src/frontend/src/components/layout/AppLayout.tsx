import { useEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import HomeGrid from './HomeGrid'
import NotFound from './NotFound'
import ToolView from '../features/ToolView'
import { FavoritesProvider } from '../../state/favorites'

const GITHUB_URL = 'https://github.com/M1XaM/kit'
const LANDING_PAGE_URL = 'https://m1xam.github.io/kit/'
const HOME_SCROLL_KEY = 'kit-home-scroll'

type HeaderBarProps = {
  status: string
}

// InfoButton renders a small info icon next to the status pill that opens a
// welcome panel: a quick intro, the GitHub link, and the "launch from the
// landing page so you can tick Always allow" tip.
function InfoButton() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click or Escape so the panel behaves like a popover.
  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="About Kit"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
          open
            ? 'border-blue-400/50 bg-blue-600/20 text-blue-200'
            : 'border-white/10 bg-white/5 text-blue-300 hover:border-white/20 hover:bg-white/10 hover:text-blue-200'
        }`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border p-4 text-left shadow-2xl border-white/10 bg-slate-950/95 backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <span>👋</span>
            Welcome to Kit
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Your local tools hub — every file is processed right here on your machine,
            nothing is uploaded. The background engine keeps running after you close this
            tab and shuts itself down a few seconds later.
          </p>

          <div className="mt-3 rounded-lg border p-3 border-blue-400/20 bg-blue-500/5">
            <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-blue-300">Launch without the prompt</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Open Kit from the{' '}
              <a href={LANDING_PAGE_URL} target="_blank" rel="noreferrer" className="text-blue-300 underline">landing page</a>{' '}
              and tick <span className="text-slate-200">“Always allow”</span> in the browser
              prompt — after that <span className="text-slate-200">kit://start</span> launches
              instantly every time.
            </p>
          </div>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-300 transition hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0 0 22 12c0-5.52-4.48-10-10-10z"></path>
            </svg>
            View source on GitHub
          </a>
        </div>
      )}
    </div>
  )
}

function HeaderBar({ status }: HeaderBarProps) {
  const pillClass = 'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[0.95rem] transition border-white/10 bg-white/5 text-blue-300 hover:border-white/20 hover:bg-white/10'
  const statusDotClass = status === 'Connected'
    ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.9)] animate-pulse'
    : 'bg-slate-500 shadow-[0_0_8px_rgba(100,116,139,0.6)]'
  const tooltipClass = 'border-blue-400/40 bg-slate-950/95 text-blue-200'

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-2 border-b px-6 py-2 text-sm backdrop-blur md:flex-row md:items-center md:justify-between border-white/10 bg-black/80 text-slate-400">
      <div className="flex flex-wrap items-center gap-3">
        <p className={pillClass}>
          Drag <a href="kit://start" className="underline decoration-slate-400 text-current">Kit</a> to your bookmarks!
        </p>
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
        <InfoButton />
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

  // Scroll restoration: remember where the home grid was scrolled to so coming
  // back from a feature page lands at the same level instead of the top, while
  // feature pages always open scrolled to the top.
  useEffect(() => {
    if (location.pathname === '/') {
      const saved = Number(sessionStorage.getItem(HOME_SCROLL_KEY) || '0')
      requestAnimationFrame(() => window.scrollTo(0, saved))
    } else {
      window.scrollTo(0, 0)
    }
  }, [location.pathname])

  useEffect(() => {
    if (location.pathname !== '/') return
    const onScroll = () => sessionStorage.setItem(HOME_SCROLL_KEY, String(window.scrollY))
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [location.pathname])

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
      </main>
    </div>
  )
}

export default AppLayout
