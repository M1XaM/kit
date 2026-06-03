import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'

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

function RecordVideoView({ tool }) {
  const recorderRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const displayStreamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const elapsedRef = useRef(0)
  const recordingsRef = useRef([])
  const previewRef = useRef(null)

  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [warning, setWarning] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [recordings, setRecordings] = useState([])
  const [includeMic, setIncludeMic] = useState(true)
  const [includeSystemAudio, setIncludeSystemAudio] = useState(false)

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
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => track.stop())
      displayStreamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null
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
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((item) => item.id !== id)
    })
  }

  // buildRecordingStream assembles the camera video track plus any requested
  // audio sources. When both the microphone and system audio are present they
  // are mixed into a single track via the Web Audio API.
  const buildRecordingStream = async () => {
    const camera = await navigator.mediaDevices.getUserMedia({ video: true, audio: includeMic })
    cameraStreamRef.current = camera

    let display = null
    if (includeSystemAudio) {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      displayStreamRef.current = display
      if (display.getAudioTracks().length === 0) {
        setWarning('No system audio was captured. Re-share and tick "Share tab/system audio" — some browsers only offer it when sharing a tab or the whole screen.')
      }
    }

    const micTracks = includeMic ? camera.getAudioTracks() : []
    const systemTracks = display ? display.getAudioTracks() : []
    const audioSources = [...micTracks, ...systemTracks]

    let audioTracks = []
    if (audioSources.length > 1) {
      // Mix multiple audio sources down to one track.
      const Ctor = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctor()
      audioCtxRef.current = ctx
      const destination = ctx.createMediaStreamDestination()
      if (micTracks.length) ctx.createMediaStreamSource(new MediaStream(micTracks)).connect(destination)
      if (systemTracks.length) ctx.createMediaStreamSource(new MediaStream(systemTracks)).connect(destination)
      audioTracks = destination.stream.getAudioTracks()
    } else {
      audioTracks = audioSources
    }

    return new MediaStream([...camera.getVideoTracks(), ...audioTracks])
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Camera access is not supported in this browser.')
      return
    }
    if (includeSystemAudio && !navigator.mediaDevices?.getDisplayMedia) {
      setErrorMessage('System audio capture is not supported in this browser.')
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
      setErrorMessage(err?.message || 'Camera or screen access was denied.')
      return
    }

    try {
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []

      if (previewRef.current) {
        previewRef.current.srcObject = cameraStreamRef.current
        previewRef.current.play().catch(() => {})
      }

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onerror = (event) => {
        setErrorMessage(event.error?.message || 'Recording error.')
        setStatus('idle')
        stopTimer()
        stopStreams()
      }

      recorder.onstop = () => {
        const fallbackType = mimeType || 'video/webm'
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
        stopStreams()
      }

      // If the user stops the screen share (system audio) from the browser UI,
      // end the recording cleanly.
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            if (recorderRef.current && (status === 'recording' || status === 'paused')) {
              stopRecording()
            }
          })
        })
      }

      recorder.start(200)
      setStatus('recording')
      elapsedRef.current = 0
      setElapsedMs(0)
      startTimer()
    } catch (err) {
      setErrorMessage(err?.message || 'Could not start recording.')
      stopStreams()
      setStatus('idle')
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
        subtitle="Record your camera with optional microphone and system audio — all without uploads."
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
            <div className="px-4 py-3 text-center text-xs text-slate-400">Live camera preview appears here while recording.</div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className={toggleClass(includeMic)}>
            <input type="checkbox" className="accent-blue-600" checked={includeMic} disabled={isLive} onChange={(event) => setIncludeMic(event.target.checked)} />
            Microphone
          </label>
          <label className={toggleClass(includeSystemAudio)}>
            <input type="checkbox" className="accent-blue-600" checked={includeSystemAudio} disabled={isLive} onChange={(event) => setIncludeSystemAudio(event.target.checked)} />
            System audio
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
          <button className="rounded-lg bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400" type="button" onClick={startRecording} disabled={isLive}>
            Start recording
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={pauseRecording} disabled={status !== 'recording'}>
            Pause
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-emerald-400/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={resumeRecording} disabled={status !== 'paused'}>
            Resume
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-slate-400/40 bg-slate-400/15 text-slate-200 hover:bg-slate-400/25 disabled:cursor-not-allowed disabled:text-slate-500" type="button" onClick={stopRecording} disabled={!isLive}>
            Stop
          </button>
          <button className="rounded-lg border px-4 py-2 text-sm font-semibold transition border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10" type="button" onClick={clearAllRecordings} disabled={!recordings.length}>
            Clear recordings
          </button>
        </div>

        <div className="text-xs text-slate-400">Camera, microphone and system audio stay on your device. No uploads are used.</div>
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
                    <a className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700" href={recording.url} download={recording.name}>
                      Download
                    </a>
                    <button className="rounded-lg border px-3 py-2 text-xs font-semibold transition border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10" type="button" onClick={() => removeRecording(recording.id)}>
                      Remove
                    </button>
                  </div>
                </div>
                <video className="mt-3 w-full rounded-lg bg-black" controls preload="metadata">
                  <source src={recording.url} type={recording.mimeType} />
                </video>
                {!recording.playable ? (
                  <div className="mt-2 text-xs text-amber-200">This browser cannot play {recording.mimeType}. Use the download instead.</div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default RecordVideoView
