import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'

const DOWNLOAD_ENDPOINT = 'https://speed.cloudflare.com/__down'
const UPLOAD_ENDPOINT = 'https://speed.cloudflare.com/__up'

// Sustained, multi-connection measurement. Several parallel streams saturate
// the link the way real speed tests do (a single TCP connection often can't),
// and averaging over the actual bytes moved during a long window is far more
// accurate than timing a few small payloads.
const MIN_DOWNLOAD_MS = 15_000
const MIN_UPLOAD_MS = 10_000
const PING_ESTIMATE_MS = 2_500
const DOWNLOAD_STREAMS = 4
const UPLOAD_STREAMS = 3
const DOWNLOAD_CHUNK_BYTES = 25_000_000
const UPLOAD_CHUNK_BYTES = 6_000_000
const PING_SAMPLES = 10
const LIVE_INTERVAL_MS = 100

const formatMbps = (value) => {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toFixed(1)
}

const formatMs = (value) => {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toFixed(0)
}

const buildDownloadUrl = (bytes) => `${DOWNLOAD_ENDPOINT}?bytes=${bytes}&cacheBust=${Date.now()}-${Math.random()}`

// measurePing samples the round-trip time with empty-body requests. Reports
// the running best (minimum) live; returns the final minimum plus jitter (the
// mean deviation between consecutive samples, like most speed tests).
const measurePing = async (onLive) => {
  const samples = []
  for (let i = 0; i < PING_SAMPLES; i += 1) {
    const start = performance.now()
    await fetch(buildDownloadUrl(0), { cache: 'no-store' })
    samples.push(performance.now() - start)
    const effective = samples.slice(1) // drop the connection warm-up sample
    if (effective.length) onLive(Math.min(...effective))
  }
  const effective = samples.length > 1 ? samples.slice(1) : samples
  const ping = effective.length ? Math.min(...effective) : 0
  let jitter = 0
  if (effective.length > 1) {
    let sum = 0
    for (let i = 1; i < effective.length; i += 1) {
      sum += Math.abs(effective[i] - effective[i - 1])
    }
    jitter = sum / (effective.length - 1)
  }
  return { ping, jitter }
}

// measureDownload runs several parallel streams for at least MIN_DOWNLOAD_MS
// and divides the actual bytes received by the elapsed time. Reading the whole
// body keeps the number honest. Returns the aggregate Mbps.
const measureDownload = async (onLive) => {
  const start = performance.now()
  let totalBytes = 0
  let lastTick = 0
  let stopped = false

  const live = () => {
    const now = performance.now()
    if (now - lastTick < LIVE_INTERVAL_MS) return
    lastTick = now
    const seconds = (now - start) / 1000
    if (seconds > 0.3) onLive((totalBytes * 8) / (seconds * 1e6))
  }

  const stream = async () => {
    while (!stopped && performance.now() - start < MIN_DOWNLOAD_MS) {
      const response = await fetch(buildDownloadUrl(DOWNLOAD_CHUNK_BYTES), { cache: 'no-store' })
      if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`)
      const reader = response.body?.getReader()
      if (!reader) {
        const buffer = await response.arrayBuffer()
        totalBytes += buffer.byteLength
        live()
        continue
      }
      let done = false
      while (!done) {
        const chunk = await reader.read()
        done = chunk.done
        if (chunk.value) totalBytes += chunk.value.length
        live()
        if (performance.now() - start >= MIN_DOWNLOAD_MS) {
          stopped = true
          await reader.cancel()
          break
        }
      }
    }
  }

  await Promise.all(Array.from({ length: DOWNLOAD_STREAMS }, stream))
  const seconds = (performance.now() - start) / 1000
  return seconds > 0 ? (totalBytes * 8) / (seconds * 1e6) : 0
}

// measureUpload posts fixed payloads over several parallel streams for at
// least MIN_UPLOAD_MS and averages over the bytes actually sent.
const measureUpload = async (onLive) => {
  const payload = new Blob([new Uint8Array(UPLOAD_CHUNK_BYTES)])
  const start = performance.now()
  let totalBytes = 0

  const live = () => {
    const seconds = (performance.now() - start) / 1000
    if (seconds > 0.3) onLive((totalBytes * 8) / (seconds * 1e6))
  }

  const stream = async () => {
    while (performance.now() - start < MIN_UPLOAD_MS) {
      await fetch(UPLOAD_ENDPOINT, {
        method: 'POST',
        mode: 'no-cors',
        body: payload,
        cache: 'no-store'
      })
      totalBytes += UPLOAD_CHUNK_BYTES
      live()
    }
  }

  await Promise.all(Array.from({ length: UPLOAD_STREAMS }, stream))
  const seconds = (performance.now() - start) / 1000
  return seconds > 0 ? (totalBytes * 8) / (seconds * 1e6) : 0
}

// useSmoothNumber eases the displayed value toward its target every frame so
// readouts glide instead of jumping between samples.
function useSmoothNumber(target) {
  const [display, setDisplay] = useState(target)
  const targetRef = useRef(target)
  targetRef.current = target

  useEffect(() => {
    if (target == null) {
      setDisplay(null)
      return
    }
    let raf = 0
    const tick = () => {
      setDisplay((prev) => {
        const goal = targetRef.current
        if (goal == null) return null
        if (prev == null) return goal
        const next = prev + (goal - prev) * 0.12
        return Math.abs(next - goal) < 0.05 ? goal : next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target == null])

  return target == null ? null : display
}

function InternetSpeed({ tool }) {
  const [isRunning, setIsRunning] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [pingMs, setPingMs] = useState(null)
  const [jitterMs, setJitterMs] = useState(null)
  const [downloadMbps, setDownloadMbps] = useState(null)
  const [uploadMbps, setUploadMbps] = useState(null)
  const [error, setError] = useState('')

  const downloadDisplay = useSmoothNumber(downloadMbps)
  const uploadDisplay = useSmoothNumber(uploadMbps)
  const pingDisplay = useSmoothNumber(pingMs)

  // Progress is driven by a time-based animation loop so the bar advances
  // smoothly regardless of how often network data events fire.
  const rafRef = useRef(0)
  const phaseRef = useRef(null)

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const enterPhase = (expected, base, span) => {
    phaseRef.current = { expected, base, span, start: performance.now() }
  }

  const startProgressLoop = () => {
    cancelAnimationFrame(rafRef.current)
    const tick = () => {
      const ph = phaseRef.current
      if (ph) {
        const local = Math.min((performance.now() - ph.start) / ph.expected, 1)
        setProgress((prev) => Math.max(prev, ph.base + ph.span * local))
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const runTest = async () => {
    if (isRunning) return

    setIsRunning(true)
    setPhase('ping')
    setProgress(0)
    setError('')
    setPingMs(null)
    setJitterMs(null)
    setDownloadMbps(null)
    setUploadMbps(null)

    phaseRef.current = null
    startProgressLoop()

    let ok = false
    try {
      enterPhase(PING_ESTIMATE_MS, 0, 0.08)
      const { ping, jitter } = await measurePing(setPingMs)
      setPingMs(ping)
      setJitterMs(jitter)

      setPhase('download')
      enterPhase(MIN_DOWNLOAD_MS, 0.08, 0.55)
      const download = await measureDownload(setDownloadMbps)
      setDownloadMbps(download)

      setPhase('upload')
      enterPhase(MIN_UPLOAD_MS, 0.63, 0.37)
      const upload = await measureUpload(setUploadMbps)
      setUploadMbps(upload)

      setPhase('done')
      ok = true
    } catch (err) {
      setError(err?.message || 'Speed test failed')
      setPhase('idle')
    } finally {
      cancelAnimationFrame(rafRef.current)
      phaseRef.current = null
      setProgress(ok ? 1 : 0)
      setIsRunning(false)
    }
  }

  const buttonLabel = !isRunning
    ? 'Start Test'
    : phase === 'ping'
      ? 'Pinging...'
      : phase === 'download'
        ? 'Downloading...'
        : phase === 'upload'
          ? 'Uploading...'
          : 'Running...'

  return (
    <div className="mx-auto max-w-5xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader
        tool={tool}
        subtitle="A sustained, multi-connection speed test against Cloudflare's edge — longer windows, honest numbers."
      />

      {error ? (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{error}</div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <div className="rounded-2xl border p-5 animate-rise border-white/10 bg-slate-950/70 shadow-[0_18px_40px_rgba(15,23,42,0.35)]" style={{ animationDelay: '0ms' }}>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Download</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-50 tabular-nums">{formatMbps(downloadDisplay)}</div>
          <div className="text-sm text-slate-300">Mbps · {DOWNLOAD_STREAMS} streams</div>
        </div>

        <div className="rounded-2xl border p-5 animate-rise border-white/10 bg-slate-950/70 shadow-[0_18px_40px_rgba(15,23,42,0.35)]" style={{ animationDelay: '80ms' }}>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Upload</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-50 tabular-nums">{formatMbps(uploadDisplay)}</div>
          <div className="text-sm text-slate-300">Mbps · {UPLOAD_STREAMS} streams</div>
        </div>

        <div className="rounded-2xl border p-5 animate-rise border-white/10 bg-slate-950/70 shadow-[0_18px_40px_rgba(15,23,42,0.35)]" style={{ animationDelay: '160ms' }}>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Ping</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-50 tabular-nums">{formatMs(pingDisplay)}</div>
          <div className="text-sm text-slate-300">ms</div>
        </div>

        <div className="rounded-2xl border p-5 animate-rise border-white/10 bg-slate-950/70 shadow-[0_18px_40px_rgba(15,23,42,0.35)]" style={{ animationDelay: '240ms' }}>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Jitter</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-50 tabular-nums">{formatMs(jitterMs)}</div>
          <div className="text-sm text-slate-300">ms</div>
        </div>
      </div>

      <div className="mt-6 flex justify-center">
        <button className="rounded-lg bg-blue-600 px-8 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" type="button" onClick={runTest} disabled={isRunning}>
          {buttonLabel}
        </button>
      </div>

      {isRunning || progress > 0 ? (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-700/40">
          {/* Unrounded width + rAF-driven progress keeps the bar gliding
              instead of stepping in 1% jumps. */}
          <div className="h-full bg-gradient-to-r from-sky-400 via-cyan-400 to-fuchsia-500" style={{ width: `${(progress * 100).toFixed(3)}%` }}></div>
        </div>
      ) : null}
    </div>
  )
}

export default InternetSpeed
