import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import RuntimePill from './RuntimePill'

const DOWNLOAD_SIZES = [5_000_000, 12_000_000, 20_000_000]
const UPLOAD_SIZES = [1_000_000, 3_000_000, 6_000_000]
const DOWNLOAD_ENDPOINT = 'https://speed.cloudflare.com/__down'
const UPLOAD_ENDPOINT = 'https://speed.cloudflare.com/__up'

const formatMbps = (value) => {
  if (value == null || Number.isNaN(value)) return '--'
  return value.toFixed(1)
}

const formatBytes = (value) => {
  if (value == null || Number.isNaN(value)) return '--'
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

const buildDownloadUrl = (bytes) => `${DOWNLOAD_ENDPOINT}?bytes=${bytes}&cacheBust=${Date.now()}`

const measureDownload = (bytes, signal) => new Promise((resolve, reject) => {
  const start = performance.now()
  const img = new Image()
  let settled = false

  const cleanup = () => {
    img.onload = null
    img.onerror = null
    img.src = ''
  }

  const finalize = () => {
    if (settled) return
    settled = true
    if (signal) signal.removeEventListener('abort', onAbort)
    cleanup()
    const duration = (performance.now() - start) / 1000
    resolve({ bytes, duration })
  }

  const onAbort = () => {
    if (settled) return
    settled = true
    cleanup()
    reject(new DOMException('Aborted', 'AbortError'))
  }

  if (signal) {
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort)
  }

  img.onload = finalize
  img.onerror = finalize
  img.src = buildDownloadUrl(bytes)
})

const buildUploadPayload = (bytes) => '0'.repeat(bytes)

const measureUpload = async (bytes, signal) => {
  const payload = buildUploadPayload(bytes)
  const start = performance.now()

  await fetch(UPLOAD_ENDPOINT, {
    method: 'POST',
    mode: 'no-cors',
    body: payload,
    cache: 'no-store',
    signal
  })

  const duration = (performance.now() - start) / 1000
  return { bytes, duration }
}

function InternetSpeed({ tool }) {
  const Icon = tool.icon
  const controllerRef = useRef(null)
  const [isRunning, setIsRunning] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [downloadMbps, setDownloadMbps] = useState(null)
  const [uploadMbps, setUploadMbps] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [error, setError] = useState('')

  const runTest = async () => {
    if (isRunning) return

    setIsRunning(true)
    setPhase('download')
    setProgress(0)
    setError('')
    setDownloadMbps(null)
    setUploadMbps(null)

    const controller = new AbortController()
    controllerRef.current = controller

    const totalSteps = DOWNLOAD_SIZES.length + UPLOAD_SIZES.length
    let completedSteps = 0

    const updateProgress = () => {
      const ratio = completedSteps / totalSteps
      setProgress(Math.min(Math.max(ratio, 0), 1))
    }

    try {
      let downloadBytes = 0
      let downloadTime = 0
      for (const size of DOWNLOAD_SIZES) {
        const result = await measureDownload(size, controller.signal)
        downloadBytes += result.bytes
        downloadTime += result.duration
        completedSteps += 1
        updateProgress()
      }

      const calculatedDownload = downloadTime > 0 ? (downloadBytes * 8) / (downloadTime * 1e6) : 0
      setDownloadMbps(calculatedDownload)

      setPhase('upload')
      let uploadBytes = 0
      let uploadTime = 0
      for (const size of UPLOAD_SIZES) {
        const result = await measureUpload(size, controller.signal)
        uploadBytes += result.bytes
        uploadTime += result.duration
        completedSteps += 1
        updateProgress()
      }

      const calculatedUpload = uploadTime > 0 ? (uploadBytes * 8) / (uploadTime * 1e6) : 0
      setUploadMbps(calculatedUpload)
      setPhase('done')
      setLastRun(new Date())
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Test stopped')
      } else {
        setError(err.message || 'Speed test failed')
      }
      setPhase('idle')
    } finally {
      setIsRunning(false)
      setProgress(0)
      controllerRef.current = null
    }
  }

  const stopTest = () => {
    if (!controllerRef.current) return
    controllerRef.current.abort()
    controllerRef.current = null
  }

  return (
    <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-white/5 p-10 text-left backdrop-blur">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${tool.colorClass}`}>
            {Icon ? <Icon /> : null}
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-50">{tool.title}</h2>
            <p className="text-sm text-slate-400">Client-side speed test powered by Cloudflare endpoints.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RuntimePill tool={tool} className="text-[0.6rem]" />
          <div className={`rounded-full border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] ${error ? 'border-red-400/50 bg-red-900/40 text-red-200' : 'border-sky-400/50 bg-sky-900/40 text-sky-200'}`}>
            {isRunning ? 'Running' : error ? 'Paused' : 'Ready'}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.35)] animate-rise" style={{ animationDelay: '0ms' }}>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Download</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-50">{formatMbps(downloadMbps)}</div>
          <div className="text-sm text-slate-300">Mbps</div>
          <div className="mt-3 text-xs text-slate-400">Payload: {DOWNLOAD_SIZES.map(formatBytes).join(' + ')}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.35)] animate-rise" style={{ animationDelay: '80ms' }}>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Upload</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-50">{formatMbps(uploadMbps)}</div>
          <div className="text-sm text-slate-300">Mbps</div>
          <div className="mt-3 text-xs text-slate-400">Payload: {UPLOAD_SIZES.map(formatBytes).join(' + ')}</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.35)] animate-rise" style={{ animationDelay: '160ms' }}>
          <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Status</div>
          <div className="mt-2 text-2xl font-extrabold text-slate-50">
            {phase === 'download' ? 'Downloading' : phase === 'upload' ? 'Uploading' : phase === 'done' ? 'Complete' : 'Idle'}
          </div>
          <div className="text-sm text-slate-300">{lastRun ? `Last run: ${lastRun.toLocaleTimeString()}` : 'Not run yet'}</div>
          <div className="mt-3 text-xs text-slate-400">Endpoint: speed.cloudflare.com</div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" type="button" onClick={runTest} disabled={isRunning}>
          {isRunning ? 'Running...' : 'Start Speed Test'}
        </button>
        <button className="rounded-lg border border-slate-400/40 bg-slate-400/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-400/25 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={stopTest} disabled={!isRunning}>
          Stop
        </button>
        <span className="text-xs text-slate-400">Runs fully in the browser. No backend traffic is used.</span>
      </div>

      {isRunning ? (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-700/40">
          <div className="h-full bg-gradient-to-r from-sky-400 via-cyan-400 to-fuchsia-500" style={{ width: `${Math.round(progress * 100)}%` }}></div>
        </div>
      ) : null}

      <div className="mt-6 text-xs text-slate-400">
        Download endpoint: {DOWNLOAD_ENDPOINT}. Upload endpoint: {UPLOAD_ENDPOINT}.
      </div>
    </div>
  )
}

export default InternetSpeed
