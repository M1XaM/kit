import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import HomeGrid from './HomeGrid'
import NotFound from './NotFound'
import ToolView from '../features/ToolView'
import RecentFilesPanel from './RecentFilesPanel'
import { FavoritesProvider } from '../../state/favorites'
import UpdatePill from './UpdatePill'

const GITHUB_URL = 'https://github.com/M1XaM/kit'
const GITHUB_ISSUES_URL = 'https://github.com/M1XaM/kit/issues'
const HOME_SCROLL_KEY = 'kit-home-scroll'

type HeaderBarProps = {
  status: string
}

// InfoButton renders a small info icon next to the status pill that reveals a
// welcome panel on hover (or keyboard focus): a quick intro, the GitHub link,
// and the "launch from the landing page so you can tick Always allow" tip.
function InfoButton() {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="About Kit"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition border-white/10 bg-white/5 text-blue-300 hover:border-white/20 hover:bg-white/10 hover:text-blue-200 group-hover:border-blue-400/50 group-hover:bg-blue-600/20 group-hover:text-blue-200 group-focus-within:border-blue-400/50 group-focus-within:bg-blue-600/20 group-focus-within:text-blue-200"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      </button>

      {/* pt-2 (not mt-2) keeps the hover region contiguous with the button so the
          panel's links stay reachable; shown via group-hover / group-focus-within. */}
      <div className="pointer-events-none absolute right-0 top-full z-30 pt-2 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <div className="w-80 rounded-xl border p-4 text-left shadow-2xl border-white/10 bg-slate-950/95 backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <span>👋</span>
            Welcome to Kit
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            Your local tools hub — every file is processed right here on your machine,
            nothing is uploaded. The background engine keeps running after you close this
            tab and shuts itself down a few seconds later.
          </p>

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
      </div>
    </div>
  )
}

// ReportBugButton mirrors the InfoButton style: a circular pill that reveals a
// small panel on hover (or keyboard focus) inviting the user to report a bug or
// propose a change, with a direct link to the GitHub issues page.
function ReportBugButton() {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="Report a bug"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition border-white/10 bg-white/5 text-amber-300 hover:border-white/20 hover:bg-white/10 hover:text-amber-200 group-hover:border-amber-400/50 group-hover:bg-amber-500/20 group-hover:text-amber-200 group-focus-within:border-amber-400/50 group-focus-within:bg-amber-500/20 group-focus-within:text-amber-200"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m8 2 1.88 1.88"></path>
          <path d="M14.12 3.88 16 2"></path>
          <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path>
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path>
          <path d="M12 20v-9"></path>
          <path d="M6.53 9C4.6 8.8 3 7.1 3 5"></path>
          <path d="M6 13H2"></path>
          <path d="M3 21c0-2.1 1.7-3.9 3.8-4"></path>
          <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"></path>
          <path d="M22 13h-4"></path>
          <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"></path>
        </svg>
      </button>

      {/* pt-2 (not mt-2) keeps the hover region contiguous with the button so the
          panel's link stays reachable; shown via group-hover / group-focus-within. */}
      <div className="pointer-events-none absolute right-0 top-full z-30 pt-2 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <div className="w-72 rounded-xl border p-4 text-left shadow-2xl border-white/10 bg-slate-950/95 backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <span>🐞</span>
            Found a bug?
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            If you ran into something broken or want to propose a change, open an
            issue on GitHub — every report helps make Kit better.
          </p>
          <a
            href={GITHUB_ISSUES_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition border-amber-400/30 bg-amber-500/10 text-amber-200 hover:border-amber-400/50 hover:bg-amber-500/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0 0 22 12c0-5.52-4.48-10-10-10z"></path>
            </svg>
            Report it on GitHub Issues
          </a>
        </div>
      </div>
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
        <UpdatePill />
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
        <ReportBugButton />
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

      <RecentFilesPanel />
    </div>
  )
}

export default AppLayout
