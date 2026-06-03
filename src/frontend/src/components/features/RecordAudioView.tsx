import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'

const MIME_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg'
]

const canPlayType = (type) => {
  if (!type || typeof Audio === 'undefined') return true
  const tester = new Audio()
  return tester.canPlayType(type) !== ''
}

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return ''
  const preferred = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type) && canPlayType(type))
  if (preferred) return preferred
  const fallback = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
  return fallback || ''
}

const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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

const resolveExtension = (type) => {
  if (type.includes('mp4')) return 'm4a'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('webm')) return 'webm'
  return 'webm'
}

const buildRecordingId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `rec-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function RecordAudioView({ tool }) {
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const elapsedRef = useRef(0)
  const recordingsRef = useRef([])

  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [recordings, setRecordings] = useState([])

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startTimer = () => {
    const startTime = Date.now() - elapsedRef.current
    stopTimer()
    timerRef.current = setInterval(() => {
      elapsedRef.current = Date.now() - startTime
      setElapsedMs(elapsedRef.current)
    }, 200)
  }

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  const clearAllRecordings = () => {
    setRecordings((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.url))
      return []
    })
    setErrorMessage('')
  }

  const removeRecording = (id) => {
    setRecordings((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) {
        URL.revokeObjectURL(target.url)
      }
      return prev.filter((item) => item.id !== id)
    })
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Microphone access is not supported in this browser.')
      return
    }

    if (status === 'recording' || status === 'paused') return

    setErrorMessage('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      streamRef.current = stream
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = (event) => {
        setErrorMessage(event.error?.message || 'Recording error.')
        setStatus('idle')
        stopTimer()
        stopStream()
      }

      recorder.onstop = () => {
        const fallbackType = mimeType || 'audio/webm'
        const finalType = recorder.mimeType || fallbackType
        const blob = new Blob(chunksRef.current, { type: finalType })
        const url = URL.createObjectURL(blob)
        const extension = resolveExtension(blob.type || finalType)
        const filename = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
        const playable = canPlayType(blob.type || finalType)

        setRecordings((prev) => [
          {
            id: buildRecordingId(),
            url,
            name: filename,
            mimeType: blob.type || finalType,
            createdAt: new Date(),
            durationMs: elapsedRef.current,
            size: blob.size,
            playable
          },
          ...prev
        ])
        chunksRef.current = []
        stopStream()
      }

      recorder.start(200)
      setStatus('recording')
      elapsedRef.current = 0
      setElapsedMs(0)
      startTimer()
    } catch (err) {
      setErrorMessage(err.message || 'Microphone access was denied.')
      stopStream()
    }
  }

  const pauseRecording = () => {
    if (recorderRef.current && status === 'recording') {
      recorderRef.current.pause()
      setStatus('paused')
      stopTimer()
    }
  }

  const resumeRecording = () => {
    if (recorderRef.current && status === 'paused') {
      recorderRef.current.resume()
      setStatus('recording')
      startTimer()
    }
  }

  const stopRecording = () => {
    if (recorderRef.current && (status === 'recording' || status === 'paused')) {
      if (recorderRef.current.state === 'recording') {
        try {
          recorderRef.current.requestData()
        } catch {}
      }
      recorderRef.current.stop()
      recorderRef.current = null
      stopTimer()
      setStatus('stopped')
    }
  }

  useEffect(() => {
    recordingsRef.current = recordings
  }, [recordings])

  useEffect(() => () => {
    stopTimer()
    stopStream()
    recordingsRef.current.forEach((item) => URL.revokeObjectURL(item.url))
  }, [])

  const statusLabel = status === 'recording'
    ? 'Recording'
    : status === 'paused'
      ? 'Paused'
      : status === 'stopped'
        ? 'Stopped'
        : 'Idle'

  const statusClass = status === 'recording'
    ? 'border-red-200 bg-red-100 text-red-700 dark:border-red-400/50 dark:bg-red-900/40 dark:text-red-200'
    : status === 'paused'
      ? 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-400/50 dark:bg-amber-900/40 dark:text-amber-200'
      : 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-400/50 dark:bg-sky-900/40 dark:text-sky-200'

  return (
    <div className="mx-auto max-w-4xl rounded-2xl border p-10 text-left border-slate-300 bg-white shadow-md dark:border-white/10 dark:bg-white/5 dark:backdrop-blur dark:shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader
        tool={tool}
        subtitle="Record, pause, resume, and download audio without uploads."
        rightSlot={(
          <div className={`rounded-full border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] ${statusClass}`}>
            {statusLabel}
          </div>
        )}
      />

      {errorMessage ? (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm border-red-200 bg-red-50 text-red-700 dark:border-red-400/50 dark:bg-red-900/25 dark:text-red-200">{errorMessage}</div>
      ) : null}

      <div className="grid gap-4 rounded-2xl border p-5 border-slate-300 bg-slate-50 dark:border-white/10 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Elapsed</div>
            <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-slate-50">{formatTime(elapsedMs)}</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-full ${status === 'recording' ? 'bg-red-500 dark:bg-red-400 animate-pulse' : status === 'paused' ? 'bg-amber-500 dark:bg-amber-300' : 'bg-slate-400 dark:bg-slate-500'}`}></span>
            {status === 'recording' ? 'Live recording' : status === 'paused' ? 'Paused' : 'Ready'}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-400" type="button" onClick={startRecording} disabled={status === 'recording' || status === 'paused'}>
            Start recording
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-amber-300 bg-amber-100 text-amber-700 hover:bg-amber-200 dark:border-amber-400/50 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500" type="button" onClick={pauseRecording} disabled={status !== 'recording'}>
            Pause
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-emerald-300 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:border-emerald-400/50 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500" type="button" onClick={resumeRecording} disabled={status !== 'paused'}>
            Resume
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-400/40 dark:bg-slate-400/15 dark:text-slate-200 dark:hover:bg-slate-400/25 disabled:cursor-not-allowed disabled:text-slate-400 dark:disabled:text-slate-500" type="button" onClick={stopRecording} disabled={status !== 'recording' && status !== 'paused'}>
            Stop
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-300 hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20 dark:hover:bg-white/10" type="button" onClick={clearAllRecordings} disabled={!recordings.length}>
            Clear recordings
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400">Microphone audio stays on your device. No uploads are used.</div>
      </div>

      {recordings.length ? (
        <div className="mt-6 rounded-2xl border p-5 border-slate-300 bg-slate-50 dark:border-white/10 dark:bg-black/30">
          <div className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Recordings</div>
          <div className="mt-4 grid gap-4">
            {recordings.map((recording) => (
              <div key={recording.id} className="rounded-xl border p-4 border-slate-300 bg-white dark:border-white/10 dark:bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{recording.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {formatTime(recording.durationMs)} · {formatBytes(recording.size)} · {recording.mimeType || 'audio'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700" href={recording.url} download={recording.name}>
                      Download
                    </a>
                    <button className="rounded-lg border px-3 py-2 text-xs font-semibold transition border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-300 hover:bg-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-white/20 dark:hover:bg-white/10" type="button" onClick={() => removeRecording(recording.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                <audio className="mt-3 w-full" controls preload="metadata">
                  <source src={recording.url} type={recording.mimeType} />
                </audio>
                {!recording.playable ? (
                  <div className="mt-2 text-xs text-amber-600 dark:text-amber-200">This browser cannot play {recording.mimeType}. Use the download instead.</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default RecordAudioView
