import { useEffect, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Footer from './Footer'
import HomeGrid from './HomeGrid'
import NotFound from './NotFound'
import ToolView from '../features/ToolView'
import { FavoritesProvider } from '../../state/favorites'

type ThemeMode = 'light' | 'dark'

const FOOTER_REPO_URL = 'https://github.com/M1XaM/kit'
const FOOTER_AUTHOR_NAME = 'Isacescu Maxim'
const THEME_STORAGE_KEY = 'kit-theme'

const getInitialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

type HeaderBarProps = {
  isDark: boolean
  status: string
  onToggleTheme: () => void
}

function HeaderBar({ isDark, status, onToggleTheme }: HeaderBarProps) {
  const pillClass = `inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[0.95rem] transition ${
    isDark
      ? 'border-white/10 bg-white/5 text-blue-300 hover:border-white/20 hover:bg-white/10'
      : 'border-slate-200/80 bg-white text-slate-600 shadow-sm hover:border-slate-300'
  }`
  const statusDotClass = status === 'Connected'
    ? isDark
      ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.9)] animate-pulse'
      : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.6)] animate-pulse'
    : isDark
      ? 'bg-slate-500 shadow-[0_0_8px_rgba(100,116,139,0.6)]'
      : 'bg-slate-400 shadow-[0_0_6px_rgba(148,163,184,0.6)]'
  const soonBadgeClass = isDark
    ? 'rounded-full border border-blue-400/50 bg-blue-600/30 px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide text-blue-200'
    : 'rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[0.7rem] font-semibold tracking-wide text-blue-700'
  const tooltipClass = isDark
    ? 'border-blue-400/40 bg-slate-950/95 text-blue-200'
    : 'border-slate-200 bg-white text-slate-600'

  return (
    <div className={`sticky top-0 z-20 flex flex-col gap-2 border-b px-6 py-2 text-sm backdrop-blur md:flex-row md:items-center md:justify-between ${
      isDark ? 'border-white/10 bg-black/80 text-slate-400' : 'border-slate-200 bg-white/80 text-slate-600'
    }`}>
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
        <a href="https://m1xam.github.io/kit/" className={pillClass}>Landing page</a>
        <button type="button" className={pillClass} onClick={onToggleTheme} aria-pressed={isDark}>
          Theme: {isDark ? 'Dark' : 'Light'}
        </button>
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
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [status, setStatus] = useState('Connecting...')

  useEffect(() => {
    const themeClass = theme === 'light' ? 'theme-light' : 'theme-dark'
    document.body.classList.remove('theme-light', 'theme-dark')
    document.body.classList.add(themeClass)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {}
  }, [theme])

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
  const isDark = theme === 'dark'
  const gridColor = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.06)'

  return (
    <div className="relative min-h-screen flex flex-col">
      <HeaderBar isDark={isDark} status={status} onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')} />

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className={`absolute -top-28 left-1/2 h-[520px] w-[min(1000px,90vw)] -translate-x-1/2 rounded-full ${isDark ? 'bg-blue-500/15' : 'bg-sky-200/70'} blur-[150px]`} />
        <div
          className={`absolute inset-0 ${isDark ? 'opacity-70' : 'opacity-50'}`}
          style={{
            backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }}
        />
      </div>

      <main className="relative z-10 flex-1">
        <div className="container mx-auto max-w-6xl px-5 pb-10 pt-12">
          <FavoritesProvider>
            <Routes>
              <Route path="/" element={<HomeGrid />} />
              <Route path="/tool/:id" element={<ToolView />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </FavoritesProvider>
        </div>
      </main>

      {showFooter && (
        <div className="relative z-10 mt-auto">
          <div className="container mx-auto max-w-6xl px-5 pb-8">
            <Footer repoUrl={FOOTER_REPO_URL} authorName={FOOTER_AUTHOR_NAME} />
          </div>
        </div>
      )}
    </div>
  )
}

export default AppLayout
