import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import { saveAs, saveToKit } from './saveRecording'

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
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const meterRafRef = useRef(null)
  const meterBarRef = useRef(null)

  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [recordings, setRecordings] = useState([])
  // Microphone permission state, resolved on page entry so the live input
  // meter can run before the user records anything.
  const [micState, setMicState] = useState('prompting') // prompting | ready | denied | unsupported

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

  const stopMeter = () => {
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current)
      meterRafRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    analyserRef.current = null
    if (meterBarRef.current) {
      meterBarRef.current.style.width = '0%'
    }
  }

  const stopStream = () => {
    stopMeter()
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }

  // startMeter drives the live input-level bar from the microphone stream via
  // a Web Audio analyser, writing the width straight to the DOM so it doesn't
  // re-render the component 60 times a second.
  const startMeter = () => {
    if (!streamRef.current) return
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    audioCtxRef.current = ctx
    const source = ctx.createMediaStreamSource(streamRef.current)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    analyserRef.current = analyser
    const buffer = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteTimeDomainData(buffer)
      let sum = 0
      for (let i = 0; i < buffer.length; i += 1) {
        const v = (buffer[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / buffer.length)
      // Boost a bit so normal speech fills a useful range, then clamp.
      const level = Math.min(100, Math.round(rms * 280))
      if (meterBarRef.current) meterBarRef.current.style.width = `${level}%`
      meterRafRef.current = requestAnimationFrame(tick)
    }
    meterRafRef.current = requestAnimationFrame(tick)
  }

  // acquireMic requests the microphone and starts the live meter. Called on
  // page entry so the permission prompt appears up front.
  const acquireMic = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicState('unsupported')
      setErrorMessage('Microphone access is not supported in this browser.')
      return false
    }
    if (streamRef.current) return true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      startMeter()
      setMicState('ready')
      setErrorMessage('')
      return true
    } catch (err) {
      setMicState('denied')
      setErrorMessage(err?.message || 'Microphone access was denied. Allow it, then reload this page.')
      return false
    }
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

  const patchRecording = (id, patch) => {
    setRecordings((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  // Save stores the clip under data/record-audio/ next to the app; Save as
  // opens the browser's save dialog instead.
  const saveRecordingToKit = async (recording) => {
    patchRecording(recording.id, { saving: true })
    try {
      const path = await saveToKit(recording.blob, 'record-audio', recording.name)
      patchRecording(recording.id, { saving: false, savedPath: path })
    } catch (err) {
      patchRecording(recording.id, { saving: false })
      setErrorMessage(err?.message || 'Could not save the recording.')
    }
  }

  const saveRecordingAs = async (recording) => {
    try {
      await saveAs(recording.blob, recording.name)
    } catch (err) {
      setErrorMessage(err?.message || 'Could not save the recording.')
    }
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Microphone access is not supported in this browser.')
      return
    }

    if (status === 'recording' || status === 'paused') return

    setErrorMessage('')

    // The mic was acquired on page entry; reuse that stream (re-acquire only
    // if it is somehow gone, e.g. the user revoked and came back).
    if (!streamRef.current) {
      const ok = await acquireMic()
      if (!ok) return
    }

    try {
      const stream = streamRef.current
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

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
            blob,
            name: filename,
            mimeType: blob.type || finalType,
            createdAt: new Date(),
            durationMs: elapsedRef.current,
            size: blob.size,
            playable,
            savedPath: '',
            saving: false
          },
          ...prev
        ])
        chunksRef.current = []
        // Keep the mic (and live meter) running for the next take.
      }

      recorder.start(200)
      setStatus('recording')
      elapsedRef.current = 0
      setElapsedMs(0)
      startTimer()
    } catch (err) {
      setErrorMessage(err.message || 'Could not start recording.')
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

  // Ask for the microphone as soon as the page opens so the prompt appears on
  // entry and the live input meter starts running.
  useEffect(() => {
    acquireMic()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    stopTimer()
    stopStream()
    recordingsRef.current.forEach((item) => URL.revokeObjectURL(item.url))
  }, [])

  return (
    <div className="mx-auto max-w-4xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader
        tool={tool}
        subtitle="Record, pause, resume, and download audio without uploads."
      />

      {errorMessage ? (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      ) : null}

      <div className="grid gap-4 rounded-2xl border p-5 border-white/10 bg-slate-950/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Elapsed</div>
            <div className="mt-1 text-3xl font-semibold text-slate-50">{formatTime(elapsedMs)}</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-full ${status === 'recording' ? 'bg-red-400 animate-pulse' : status === 'paused' ? 'bg-amber-300' : 'bg-slate-500'}`}></span>
            {status === 'recording' ? 'Live recording' : status === 'paused' ? 'Paused' : 'Ready'}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Input level</div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <div ref={meterBarRef} className="h-full w-0 rounded-full bg-emerald-400 transition-[width] duration-75" />
          </div>
          {micState === 'prompting' ? (
            <div className="mt-2 text-xs text-slate-400">Allow microphone access to see your live input level…</div>
          ) : micState === 'denied' ? (
            <div className="mt-2 text-xs text-amber-200">Microphone access was blocked. Allow it in your browser, then reload this page.</div>
          ) : micState === 'unsupported' ? (
            <div className="mt-2 text-xs text-amber-200">This browser does not support microphone capture.</div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">Speak to test your mic — the bar reacts in real time.</div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" type="button" onClick={startRecording} disabled={status === 'recording' || status === 'paused'}>
            Start recording
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={pauseRecording} disabled={status !== 'recording'}>
            Pause
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-blue-400/50 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={resumeRecording} disabled={status !== 'paused'}>
            Resume
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-slate-400/40 bg-slate-400/15 text-slate-200 hover:bg-slate-400/25 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={stopRecording} disabled={status !== 'recording' && status !== 'paused'}>
            Stop
          </button>
        </div>

        <div className="text-xs text-slate-400">Microphone audio stays on your device. No uploads are used.</div>
      </div>

      {recordings.length ? (
        <div className="mt-6 rounded-2xl border p-5 border-white/10 bg-black/30">
          <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Recordings</div>
          <div className="mt-4 grid gap-4">
            {recordings.map((recording) => (
              <div key={recording.id} className="rounded-xl border p-4 border-white/10 bg-slate-950/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{recording.name}</div>
                    <div className="text-xs text-slate-400">
                      {formatTime(recording.durationMs)} · {formatBytes(recording.size)} · {recording.mimeType || 'audio'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700"
                      type="button"
                      onClick={() => saveRecordingToKit(recording)}
                      disabled={recording.saving}
                      title="Save into data/record-audio/ next to the app"
                    >
                      {recording.saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      className="rounded-lg border px-3 py-2 text-xs font-semibold transition border-slate-400/40 bg-slate-400/15 text-slate-200 hover:bg-slate-400/25"
                      type="button"
                      onClick={() => saveRecordingAs(recording)}
                      title="Choose where to save the file"
                    >
                      Save as…
                    </button>
                    <button className="rounded-lg border px-3 py-2 text-xs font-semibold transition border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10" type="button" onClick={() => removeRecording(recording.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                {recording.savedPath ? (
                  <div className="mt-2 break-all text-xs text-emerald-300">Saved to {recording.savedPath}</div>
                ) : null}
                <audio className="mt-3 w-full" controls preload="metadata" src={recording.url} />
                {!recording.playable ? (
                  <div className="mt-2 text-xs text-amber-200">This browser cannot play {recording.mimeType}. Use Save as instead.</div>
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
