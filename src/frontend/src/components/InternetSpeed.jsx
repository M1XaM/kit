import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

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
    <div className="tool-view tool-view-wide speed-view">
      <Link to="/" className="back-btn">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <div className="tool-header">
        <div className="tool-header-left">
          <div className={`tool-icon ${tool.colorClass}`}>
            {Icon ? <Icon /> : null}
          </div>
          <div>
            <h2>{tool.title}</h2>
            <p className="tool-subtitle">Client-side speed test powered by Cloudflare endpoints.</p>
          </div>
        </div>
        <div className={`live-chip ${error ? 'status-warn' : 'status-live'}`}>
          {isRunning ? 'Running' : error ? 'Paused' : 'Ready'}
        </div>
      </div>

      {error ? <div className="tool-alert">{error}</div> : null}

      <div className="speed-grid">
        <div className="speed-card" style={{ '--delay': '0ms' }}>
          <div className="speed-label">Download</div>
          <div className="speed-value">{formatMbps(downloadMbps)}</div>
          <div className="speed-unit">Mbps</div>
          <div className="speed-sub">Payload: {DOWNLOAD_SIZES.map(formatBytes).join(' + ')}</div>
        </div>

        <div className="speed-card" style={{ '--delay': '80ms' }}>
          <div className="speed-label">Upload</div>
          <div className="speed-value">{formatMbps(uploadMbps)}</div>
          <div className="speed-unit">Mbps</div>
          <div className="speed-sub">Payload: {UPLOAD_SIZES.map(formatBytes).join(' + ')}</div>
        </div>

        <div className="speed-card" style={{ '--delay': '160ms' }}>
          <div className="speed-label">Status</div>
          <div className="speed-value">
            {phase === 'download' ? 'Downloading' : phase === 'upload' ? 'Uploading' : phase === 'done' ? 'Complete' : 'Idle'}
          </div>
          <div className="speed-unit">{lastRun ? `Last run: ${lastRun.toLocaleTimeString()}` : 'Not run yet'}</div>
          <div className="speed-sub">Endpoint: speed.cloudflare.com</div>
        </div>
      </div>

      <div className="speed-actions">
        <button className="primary-btn" type="button" onClick={runTest} disabled={isRunning}>
          {isRunning ? 'Running...' : 'Start Speed Test'}
        </button>
        <button className="secondary-btn" type="button" onClick={stopTest} disabled={!isRunning}>
          Stop
        </button>
        <span className="speed-note">Runs fully in the browser. No backend traffic is used.</span>
      </div>

      {isRunning ? (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }}></div>
        </div>
      ) : null}

      <div className="tool-footer">
        Download endpoint: {DOWNLOAD_ENDPOINT}. Upload endpoint: {UPLOAD_ENDPOINT}.
      </div>
    </div>
  )
}

export default InternetSpeed
