import { useCallback, useEffect, useRef, useState } from 'react'

// UpdateStatus mirrors the payload of /api/update/status. The backend polls
// GitHub on its own schedule; this component only reads the cached answer.
type UpdateStatus = {
  currentVersion: string
  latestVersion: string
  available: boolean
  supported: boolean
  reason?: string
  stage: 'idle' | 'downloading' | 'verifying' | 'installing' | 'restarting' | 'error'
  progress: number
  error?: string
  releaseUrl?: string
  checkedAt?: string
  checkError?: string
}

// Idle polling cadence. Cheap: it hits Kit's own server, which answers from the
// last cached GitHub check rather than calling out on every request.
const IDLE_POLL_MS = 30_000
// While an update is running the pill shows live progress, so poll faster.
const ACTIVE_POLL_MS = 1_000

const BUSY_STAGES = ['downloading', 'verifying', 'installing', 'restarting']

const STAGE_LABELS: Record<string, string> = {
  verifying: 'Verifying download…',
  installing: 'Installing…',
  restarting: 'Restarting Kit…'
}

type RestingState = {
  dotClass: string
  label: string
  labelClass: string
  detail: string
  onClick?: () => void
}

// What the pill says when no update is running. "Up to date" is only claimed
// off a check that actually succeeded: a machine that couldn't reach GitHub,
// or a build that can't update itself, says so instead of implying it is
// current.
function restingState(status: UpdateStatus, onRestore: () => void): RestingState {
  if (!status.supported) {
    return {
      dotClass: 'bg-slate-500',
      label: 'Updates off',
      labelClass: 'text-slate-400',
      detail: status.reason || "This build doesn't update itself."
    }
  }
  if (status.available) {
    // The offer was dismissed a moment ago — keep it one click away.
    return {
      dotClass: 'bg-emerald-400',
      label: `${status.latestVersion} available`,
      labelClass: 'text-emerald-300',
      detail: 'Show the update again',
      onClick: onRestore
    }
  }
  if (status.checkError) {
    return {
      dotClass: 'bg-amber-400/70',
      label: "Couldn't check",
      labelClass: 'text-slate-400',
      detail: `Kit could not reach GitHub: ${status.checkError}`
    }
  }
  if (!status.checkedAt) {
    return {
      dotClass: 'bg-slate-500',
      label: 'Checking…',
      labelClass: 'text-slate-400',
      detail: 'Looking for a newer release'
    }
  }
  return {
    dotClass: 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.9)]',
    label: 'Up to date',
    labelClass: 'text-slate-400',
    detail: `Last checked ${new Date(status.checkedAt).toLocaleTimeString()}`
  }
}

function UpdatePill() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [dismissed, setDismissed] = useState(false)
  // Read by the polling loop so it can pick its cadence without being torn
  // down and rebuilt every time the status changes.
  const liveRef = useRef({ stage: 'idle', starting: false })
  const pollNowRef = useRef<() => void>(() => {})
  const sawRestart = useRef(false)

  const busy = !!status && BUSY_STAGES.includes(status.stage)

  useEffect(() => {
    let mounted = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const active = () => liveRef.current.starting || BUSY_STAGES.includes(liveRef.current.stage)

    const poll = async () => {
      if (timer) clearTimeout(timer)
      try {
        const res = await fetch('/api/update/status')
        if (res.ok && mounted) {
          const next: UpdateStatus = await res.json()
          // The server answering now is the new build, but this page is still
          // running the old bundle — reload rather than leave the two halves
          // mismatched.
          if (sawRestart.current && next.stage === 'idle') {
            window.location.reload()
            return
          }
          if (next.stage === 'restarting') sawRestart.current = true
          liveRef.current.stage = next.stage
          // The server picked the request up, so the local "starting" spinner
          // can hand over to the reported stage.
          if (BUSY_STAGES.includes(next.stage) || next.stage === 'error') {
            liveRef.current.starting = false
            setStarting(false)
          }
          setStatus(next)
        }
      } catch {
        // Offline, or the server is restarting under us — keep the last status
        // and try again on the next tick.
      }
      if (!mounted) return
      timer = setTimeout(poll, active() ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    }

    pollNowRef.current = poll
    poll()

    return () => {
      mounted = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  const install = useCallback(async () => {
    setStartError('')
    setStarting(true)
    liveRef.current.starting = true
    try {
      const res = await fetch('/api/update/install', { method: 'POST' })
      if (!res.ok) {
        setStartError((await res.text()).trim() || 'Could not start the update.')
        setStarting(false)
        liveRef.current.starting = false
        return
      }
      // Switch to the fast cadence right away so progress starts moving
      // instead of waiting out the idle interval.
      pollNowRef.current()
    } catch {
      setStartError('Could not reach the local server.')
      setStarting(false)
      liveRef.current.starting = false
    }
  }, [])

  // Nothing to say until the first status lands, so the header doesn't flash a
  // placeholder on every load.
  if (!status) return null

  const failed = status.stage === 'error'
  const pillBase = 'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[0.95rem] transition'

  if (busy || starting) {
    const pct = Math.round((status.progress || 0) * 100)
    const label = status.stage === 'downloading'
      ? `Downloading update… ${pct}%`
      : STAGE_LABELS[status.stage] || 'Preparing update…'
    return (
      <div className={`${pillBase} border-blue-400/40 bg-blue-500/15 text-blue-200`} role="status" aria-live="polite">
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-blue-300"></span>
        {label}
      </div>
    )
  }

  if (failed) {
    return (
      <div className={`${pillBase} border-rose-400/40 bg-rose-500/15 text-rose-200`}>
        <span title={status.error}>Update failed</span>
        <button
          type="button"
          onClick={install}
          className="rounded-full border border-rose-300/40 px-2.5 py-0.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/25"
        >
          Try again
        </button>
        {status.releaseUrl && (
          <a
            href={status.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-rose-100 underline decoration-rose-300/60"
          >
            Download manually
          </a>
        )}
      </div>
    )
  }

  if (status.available && !dismissed) {
    return (
      <div className={`${pillBase} border-emerald-400/40 bg-emerald-500/15 text-emerald-200`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 19V5"></path>
          <path d="m5 12 7-7 7 7"></path>
        </svg>
        <span>
          Kit {status.latestVersion} is out —{' '}
          <span className="text-emerald-300/70">you're on {status.currentVersion}</span>
        </span>
        <button
          type="button"
          onClick={install}
          className="rounded-full border border-emerald-300/50 bg-emerald-400/20 px-3 py-0.5 text-xs font-semibold text-emerald-50 transition hover:bg-emerald-400/35"
        >
          Update now
        </button>
        {startError && <span className="text-xs text-rose-200">{startError}</span>}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update notice"
          className="text-emerald-200/60 transition hover:text-emerald-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12"></path>
          </svg>
        </button>
      </div>
    )
  }

  // Resting state: which version is running, and whether it is the current one.
  const resting = restingState(status, () => setDismissed(false))
  return (
    <div className={`${pillBase} border-white/10 bg-white/5 text-slate-300`} title={resting.detail}>
      <span className={`inline-block h-2 w-2 rounded-full ${resting.dotClass}`}></span>
      <span className="font-medium text-slate-200">{status.currentVersion}</span>
      <span className="text-slate-400">·</span>
      {resting.onClick ? (
        <button type="button" onClick={resting.onClick} className="font-semibold text-emerald-300 transition hover:text-emerald-200">
          {resting.label}
        </button>
      ) : (
        <span className={resting.labelClass}>{resting.label}</span>
      )}
    </div>
  )
}

export default UpdatePill
