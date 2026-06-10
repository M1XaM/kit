import { useEffect, useRef, useState } from 'react'

type MediaTrimTimelineProps = {
  src: string
  isAudio: boolean
  disabled?: boolean
  // Reports the current selection in seconds whenever it changes.
  onChange: (startSec: number, endSec: number) => void
}

type DragMode = 'start' | 'end' | 'seek'

const MIN_GAP = 0.05
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

// formatTime renders seconds as m:ss.d (tenths) so fine trims stay legible.
function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const secs = whole % 60
  const tenths = Math.floor((seconds - whole) * 10)
  return `${minutes}:${secs.toString().padStart(2, '0')}.${tenths}`
}

// parseTime accepts either plain seconds ("12.5") or mm:ss(.d) and returns
// seconds, or null when it can't be parsed.
function parseTime(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length > 3) return null
    let total = 0
    for (const part of parts) {
      const n = Number(part)
      if (!Number.isFinite(n) || n < 0) return null
      total = total * 60 + n
    }
    return total
  }
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// MediaTrimTimeline is an interactive in/out trimmer: a video (or audio)
// element with a scrubbable timeline below it. The user drags the green
// (start) and red (end) handles to cut the clip, with numeric time fields as
// an alternative. Selection is reported up in seconds.
function MediaTrimTimeline({ src, isAudio, disabled, onChange }: MediaTrimTimelineProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(0)
  const [current, setCurrent] = useState(0)
  const [drag, setDrag] = useState<DragMode | null>(null)
  // Local text for the numeric fields so partial edits don't fight the slider.
  const [startText, setStartText] = useState('0:00.0')
  const [endText, setEndText] = useState('0:00.0')

  // Reset everything when a new file (src) is loaded.
  useEffect(() => {
    setDuration(0)
    setStartSec(0)
    setEndSec(0)
    setCurrent(0)
  }, [src])

  // Push selection changes up to the parent and keep the text fields in sync
  // unless that field is the one currently being dragged.
  useEffect(() => {
    onChange(startSec, endSec)
    if (drag !== 'start') setStartText(formatTime(startSec))
    if (drag !== 'end') setEndText(formatTime(endSec))
    // onChange is recreated each render by the parent; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSec, endSec, drag])

  const onLoadedMetadata = () => {
    const media = mediaRef.current
    if (!media) return
    const d = Number.isFinite(media.duration) ? media.duration : 0
    setDuration(d)
    setStartSec(0)
    setEndSec(d)
  }

  const timeFromClientX = (clientX: number) => {
    const track = trackRef.current
    if (!track || duration <= 0) return 0
    const rect = track.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    return ratio * duration
  }

  // Dragging is handled on the window so the pointer can leave the track.
  useEffect(() => {
    if (!drag) return
    const onMove = (event: PointerEvent) => {
      const t = timeFromClientX(event.clientX)
      if (drag === 'start') {
        setStartSec(clamp(t, 0, endSec - MIN_GAP))
      } else if (drag === 'end') {
        setEndSec(clamp(t, startSec + MIN_GAP, duration))
      } else {
        const media = mediaRef.current
        if (media) media.currentTime = t
        setCurrent(t)
      }
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, startSec, endSec, duration])

  const onTimeUpdate = () => {
    const media = mediaRef.current
    if (!media) return
    // Loop playback within the selected region for a live preview of the cut.
    if (media.currentTime >= endSec) {
      media.pause()
      media.currentTime = startSec
    }
    setCurrent(media.currentTime)
  }

  const playSelection = () => {
    const media = mediaRef.current
    if (!media) return
    media.currentTime = startSec
    void media.play()
  }

  const commitStartText = () => {
    const parsed = parseTime(startText)
    if (parsed === null) {
      setStartText(formatTime(startSec))
      return
    }
    setStartSec(clamp(parsed, 0, endSec - MIN_GAP))
  }

  const commitEndText = () => {
    const parsed = parseTime(endText)
    if (parsed === null) {
      setEndText(formatTime(endSec))
      return
    }
    setEndSec(clamp(parsed, startSec + MIN_GAP, duration))
  }

  const pct = (value: number) => (duration > 0 ? (value / duration) * 100 : 0)
  const startPct = pct(startSec)
  const endPct = pct(endSec)
  const currentPct = pct(current)

  const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
  const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white disabled:opacity-50'
  const handleBase =
    'absolute top-0 z-20 flex h-full w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded'

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
        {isAudio ? (
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={src}
            controls
            className="w-full"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
          />
        ) : (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={src}
            controls
            className="mx-auto max-h-72"
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
          />
        )}
      </div>

      {/* Timeline track */}
      <div className="select-none px-1.5">
        <div
          ref={trackRef}
          className={`relative h-12 rounded-lg border border-white/10 bg-slate-900/70 ${duration > 0 ? '' : 'opacity-50'}`}
          onPointerDown={(event) => {
            if (disabled || duration <= 0) return
            const t = timeFromClientX(event.clientX)
            const media = mediaRef.current
            if (media) media.currentTime = t
            setCurrent(t)
            setDrag('seek')
          }}
        >
          {/* Dimmed regions outside the selection */}
          <div className="absolute inset-y-0 left-0 rounded-l-lg bg-black/50" style={{ width: `${startPct}%` }} />
          <div className="absolute inset-y-0 right-0 rounded-r-lg bg-black/50" style={{ width: `${100 - endPct}%` }} />

          {/* Selected region */}
          <div
            className="absolute inset-y-0 border-y-2 border-blue-500/70 bg-blue-500/15"
            style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
          />

          {/* Playhead */}
          <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/80" style={{ left: `${currentPct}%` }} />

          {/* Start handle */}
          <div
            className={`${handleBase} bg-blue-500 hover:bg-blue-400`}
            style={{ left: `${startPct}%` }}
            onPointerDown={(event) => {
              if (disabled || duration <= 0) return
              event.stopPropagation()
              setDrag('start')
            }}
          >
            <span className="h-5 w-0.5 rounded bg-white/90" />
          </div>

          {/* End handle */}
          <div
            className={`${handleBase} bg-rose-500 hover:bg-rose-400`}
            style={{ left: `${endPct}%` }}
            onPointerDown={(event) => {
              if (disabled || duration <= 0) return
              event.stopPropagation()
              setDrag('end')
            }}
          >
            <span className="h-5 w-0.5 rounded bg-white/90" />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>Selected: {formatTime(endSec - startSec)}</span>
          <button
            type="button"
            onClick={playSelection}
            disabled={disabled || duration <= 0}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-1 font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
          >
            ▶ Play selection
          </button>
        </div>
      </div>

      {/* Numeric fields as an alternative to dragging */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Start (mm:ss)</label>
          <input
            className={inputClass}
            type="text"
            value={startText}
            disabled={disabled}
            onChange={(event) => setStartText(event.target.value)}
            onBlur={commitStartText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
        </div>
        <div>
          <label className={labelClass}>End (mm:ss)</label>
          <input
            className={inputClass}
            type="text"
            value={endText}
            disabled={disabled}
            onChange={(event) => setEndText(event.target.value)}
            onBlur={commitEndText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default MediaTrimTimeline
