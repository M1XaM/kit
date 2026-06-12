import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import { saveAs, saveToKit } from './saveRecording'

const VIDEO_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
  'video/mp4'
]

const canPlayType = (type) => {
  if (!type || typeof document === 'undefined') return true
  const tester = document.createElement('video')
  return tester.canPlayType(type.split(';')[0]) !== ''
}

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return ''
  const preferred = VIDEO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type) && canPlayType(type))
  if (preferred) return preferred
  const fallback = VIDEO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
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
  if (type.includes('mp4')) return 'mp4'
  if (type.includes('webm')) return 'webm'
  return 'webm'
}

const buildRecordingId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `rec-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function ScreenRecordView({ tool }) {
  const recorderRef = useRef(null)
  const displayStreamRef = useRef(null)
  const micStreamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const elapsedRef = useRef(0)
  const recordingsRef = useRef([])
  const previewRef = useRef(null)
  const statusRef = useRef('idle')

  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [warning, setWarning] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [recordings, setRecordings] = useState([])
  const [includeMic, setIncludeMic] = useState(false)
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true)

  const setStatusTracked = (next) => {
    statusRef.current = next
    setStatus(next)
  }

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

  const stopStreams = () => {
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => track.stop())
      displayStreamRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop())
      micStreamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null
    }
  }

  const patchRecording = (id, patch) => {
    setRecordings((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  // Save stores the clip under data/screen-recording/ next to the app; Save as
  // opens the browser's save dialog instead.
  const saveRecordingToKit = async (recording) => {
    patchRecording(recording.id, { saving: true })
    try {
      const path = await saveToKit(recording.blob, 'screen-recording', recording.name)
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

  const removeRecording = (id) => {
    setRecordings((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((item) => item.id !== id)
    })
  }

  // buildRecordingStream captures the screen plus any requested audio sources.
  // When both system audio and the microphone are present they are mixed into
  // a single track via the Web Audio API.
  const buildRecordingStream = async () => {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: includeSystemAudio })
    displayStreamRef.current = display
    if (includeSystemAudio && display.getAudioTracks().length === 0) {
      setWarning('No system audio was captured. Re-share and tick "Share tab/system audio" — some browsers only offer it when sharing a tab or the whole screen.')
    }

    let mic = null
    if (includeMic) {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = mic
    }

    const systemTracks = display.getAudioTracks()
    const micTracks = mic ? mic.getAudioTracks() : []
    const audioSources = [...systemTracks, ...micTracks]

    let audioTracks = []
    if (audioSources.length > 1) {
      // Mix multiple audio sources down to one track.
      const Ctor = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctor()
      audioCtxRef.current = ctx
      const destination = ctx.createMediaStreamDestination()
      if (systemTracks.length) ctx.createMediaStreamSource(new MediaStream(systemTracks)).connect(destination)
      if (micTracks.length) ctx.createMediaStreamSource(new MediaStream(micTracks)).connect(destination)
      audioTracks = destination.stream.getAudioTracks()
    } else {
      audioTracks = audioSources
    }

    return new MediaStream([...display.getVideoTracks(), ...audioTracks])
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setErrorMessage('Screen capture is not supported in this browser.')
      return
    }
    if (status === 'recording' || status === 'paused') return

    setErrorMessage('')
    setWarning('')

    let stream
    try {
      stream = await buildRecordingStream()
    } catch (err) {
      stopStreams()
      setErrorMessage(err?.message || 'Screen or microphone access was denied.')
      return
    }

    try {
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []

      if (previewRef.current) {
        previewRef.current.srcObject = displayStreamRef.current
        previewRef.current.play().catch(() => {})
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = (event) => {
        setErrorMessage(event.error?.message || 'Recording error.')
        setStatusTracked('idle')
        stopTimer()
        stopStreams()
      }

      recorder.onstop = () => {
        const fallbackType = mimeType || 'video/webm'
        const finalType = recorder.mimeType || fallbackType
        const blob = new Blob(chunksRef.current, { type: finalType })
        const url = URL.createObjectURL(blob)
        const extension = resolveExtension(blob.type || finalType)
        const filename = `screen-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
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
        stopStreams()
      }

      // If the user ends the screen share from the browser UI, finish the
      // recording cleanly instead of capturing a dead stream.
      displayStreamRef.current.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (recorderRef.current && (statusRef.current === 'recording' || statusRef.current === 'paused')) {
            stopRecording()
          }
        })
      })

      recorder.start(200)
      setStatusTracked('recording')
      elapsedRef.current = 0
      setElapsedMs(0)
      startTimer()
    } catch (err) {
      setErrorMessage(err?.message || 'Could not start recording.')
      stopStreams()
      setStatusTracked('idle')
    }
  }

  const pauseRecording = () => {
    if (recorderRef.current && statusRef.current === 'recording') {
      recorderRef.current.pause()
      setStatusTracked('paused')
      stopTimer()
    }
  }

  const resumeRecording = () => {
    if (recorderRef.current && statusRef.current === 'paused') {
      recorderRef.current.resume()
      setStatusTracked('recording')
      startTimer()
    }
  }

  const stopRecording = () => {
    if (recorderRef.current && (statusRef.current === 'recording' || statusRef.current === 'paused')) {
      if (recorderRef.current.state === 'recording') {
        try {
          recorderRef.current.requestData()
        } catch {}
      }
      recorderRef.current.stop()
      recorderRef.current = null
      stopTimer()
      setStatusTracked('stopped')
    }
  }

  useEffect(() => {
    recordingsRef.current = recordings
  }, [recordings])

  useEffect(() => () => {
    stopTimer()
    stopStreams()
    recordingsRef.current.forEach((item) => URL.revokeObjectURL(item.url))
  }, [])

  const isLive = status === 'recording' || status === 'paused'

  const toggleClass = (active) =>
    `flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
      active
        ? 'border-blue-500 bg-blue-600 text-white'
        : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
    } ${isLive ? 'cursor-not-allowed opacity-60' : ''}`

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
        subtitle="Capture your screen with optional system audio and microphone — all without uploads."
      />

      {errorMessage ? (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      ) : null}
      {warning ? (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm border-amber-400/50 bg-amber-900/25 text-amber-200">{warning}</div>
      ) : null}

      <div className="grid gap-4 rounded-2xl border p-5 border-white/10 bg-slate-950/70">
        <div className="overflow-hidden rounded-xl border bg-black border-white/10">
          <video
            ref={previewRef}
            className="aspect-video w-full bg-black object-contain"
            muted
            autoPlay
            playsInline
          />
          {!isLive ? (
            <div className="px-4 py-3 text-center text-xs text-slate-400">
              Press Start recording to choose a screen, window or tab — the live preview appears here.
              <span className="mt-1 block text-slate-500">Browsers require a click before sharing your screen, so this one can’t pre-ask on page load like the camera and microphone tools.</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className={toggleClass(includeSystemAudio)}>
            <input type="checkbox" className="accent-blue-600" checked={includeSystemAudio} disabled={isLive} onChange={(event) => setIncludeSystemAudio(event.target.checked)} />
            System audio
          </label>
          <label className={toggleClass(includeMic)}>
            <input type="checkbox" className="accent-blue-600" checked={includeMic} disabled={isLive} onChange={(event) => setIncludeMic(event.target.checked)} />
            Microphone
          </label>
        </div>

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

        <div className="flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" type="button" onClick={startRecording} disabled={isLive}>
            Start recording
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={pauseRecording} disabled={status !== 'recording'}>
            Pause
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-blue-400/50 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={resumeRecording} disabled={status !== 'paused'}>
            Resume
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-slate-400/40 bg-slate-400/15 text-slate-200 hover:bg-slate-400/25 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={stopRecording} disabled={!isLive}>
            Stop
          </button>
        </div>

        <div className="text-xs text-slate-400">Your screen, system audio and microphone stay on your device. No uploads are used.</div>
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
                      {formatTime(recording.durationMs)} · {formatBytes(recording.size)} · {recording.mimeType || 'video'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700"
                      type="button"
                      onClick={() => saveRecordingToKit(recording)}
                      disabled={recording.saving}
                      title="Save into data/screen-recording/ next to the app"
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
                <video className="mt-3 w-full rounded-lg bg-black" controls preload="metadata" src={recording.url} />
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

export default ScreenRecordView
