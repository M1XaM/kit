import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mp3Encoder } from '@breezystack/lamejs'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type MergeAudioViewProps = {
  tool: Tool
}

type TrackStatus = 'decoding' | 'ready' | 'error'

type Track = {
  id: string
  file: File
  url: string
  name: string
  size: number
  durationMs: number | null
  buffer: AudioBuffer | null
  status: TrackStatus
}

type MergeResult = {
  url: string
  name: string
  size: number
  format: 'wav' | 'mp3'
  durationMs: number
}

// Sample rates the MPEG/MP3 encoder accepts. When the chosen output is MP3 and
// the source rate isn't one of these, we fall back to 44.1 kHz (the offline
// context resamples every source to that rate automatically).
const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]
const MP3_BLOCK_SIZE = 1152

const formatBytes = (value: number | null) => {
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

const formatTime = (ms: number | null) => {
  if (ms == null || Number.isNaN(ms)) return '--:--'
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const buildId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `trk-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const clampSample = (value: number) => {
  if (value < -1) return -1
  if (value > 1) return 1
  return value
}

// encodeWav writes a 16-bit PCM WAV (RIFF) from a rendered AudioBuffer.
const encodeWav = (buffer: AudioBuffer): Blob => {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const frames = buffer.length
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = frames * blockAlign
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = clampSample(channels[c][i])
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([out], { type: 'audio/wav' })
}

// floatToInt16 converts a Float32 PCM channel to the Int16 samples lamejs wants.
const floatToInt16 = (input: Float32Array): Int16Array => {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = clampSample(input[i])
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// encodeMp3 encodes a rendered AudioBuffer (mono or stereo) to an MP3 Blob.
const encodeMp3 = (buffer: AudioBuffer, kbps: number): Blob => {
  const numChannels = Math.min(2, buffer.numberOfChannels)
  const encoder = new Mp3Encoder(numChannels, buffer.sampleRate, kbps)
  const left = floatToInt16(buffer.getChannelData(0))
  const right = numChannels > 1 ? floatToInt16(buffer.getChannelData(1)) : null

  const chunks: Uint8Array[] = []
  for (let i = 0; i < left.length; i += MP3_BLOCK_SIZE) {
    const leftChunk = left.subarray(i, i + MP3_BLOCK_SIZE)
    const encoded = right
      ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + MP3_BLOCK_SIZE))
      : encoder.encodeBuffer(leftChunk)
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded))
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(new Uint8Array(tail))

  return new Blob(chunks as BlobPart[], { type: 'audio/mpeg' })
}

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-300 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white'

function MergeAudioView({ tool }: MergeAudioViewProps) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [outputFormat, setOutputFormat] = useState<'wav' | 'mp3'>('wav')
  const [mp3Bitrate, setMp3Bitrate] = useState('192')
  const [gapSeconds, setGapSeconds] = useState('0')
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [result, setResult] = useState<MergeResult | null>(null)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const tracksRef = useRef<Track[]>([])
  const resultRef = useRef<MergeResult | null>(null)

  useEffect(() => { tracksRef.current = tracks }, [tracks])
  useEffect(() => { resultRef.current = result }, [result])

  // Revoke every object URL we created when the view unmounts.
  useEffect(() => () => {
    tracksRef.current.forEach((t) => URL.revokeObjectURL(t.url))
    if (resultRef.current) URL.revokeObjectURL(resultRef.current.url)
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
  }, [])

  const getAudioContext = (): AudioContext => {
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtxRef.current = new Ctor()
    }
    return audioCtxRef.current
  }

  const updateTrack = (id: string, patch: Partial<Track>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  const decodeTrack = async (track: Track) => {
    try {
      const arrayBuffer = await track.file.arrayBuffer()
      const buffer = await getAudioContext().decodeAudioData(arrayBuffer)
      updateTrack(track.id, { buffer, durationMs: buffer.duration * 1000, status: 'ready' })
    } catch {
      updateTrack(track.id, { status: 'error' })
    }
  }

  const addFiles = (files: FileList | null) => {
    const incoming = Array.from(files || []).filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba|webm)$/i.test(f.name))
    if (!incoming.length) return
    setResult(null)
    setErrorMessage('')
    const newTracks: Track[] = incoming.map((file) => ({
      id: buildId(),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
      durationMs: null,
      buffer: null,
      status: 'decoding'
    }))
    setTracks((prev) => [...prev, ...newTracks])
    newTracks.forEach(decodeTrack)
  }

  const removeTrack = (id: string) => {
    setTracks((prev) => {
      const target = prev.find((t) => t.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((t) => t.id !== id)
    })
  }

  const moveTrack = (index: number, direction: -1 | 1) => {
    setTracks((prev) => {
      const next = index + direction
      if (next < 0 || next >= prev.length) return prev
      const copy = [...prev]
      ;[copy[index], copy[next]] = [copy[next], copy[index]]
      return copy
    })
  }

  const readyTracks = useMemo(() => tracks.filter((t) => t.status === 'ready' && t.buffer), [tracks])
  const decodingCount = useMemo(() => tracks.filter((t) => t.status === 'decoding').length, [tracks])

  const clearResult = () => {
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  const mergeAndExport = async () => {
    if (readyTracks.length < 2) {
      setErrorMessage('Add at least two playable audio files to merge.')
      return
    }

    setIsProcessing(true)
    setErrorMessage('')
    clearResult()

    try {
      const gap = Math.max(0, Number(gapSeconds) || 0)
      const buffers = readyTracks.map((t) => t.buffer as AudioBuffer)

      let targetRate = buffers.reduce((max, b) => Math.max(max, b.sampleRate), 0) || 44100
      const targetChannels = Math.min(2, buffers.reduce((max, b) => Math.max(max, b.numberOfChannels), 1))
      if (outputFormat === 'mp3' && !MP3_SAMPLE_RATES.includes(targetRate)) {
        targetRate = 44100
      }

      const totalDuration = buffers.reduce((sum, b) => sum + b.duration, 0) + gap * (buffers.length - 1)
      const totalFrames = Math.max(1, Math.ceil(totalDuration * targetRate))

      const OfflineCtor =
        window.OfflineAudioContext ||
        (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
      const offline = new OfflineCtor(targetChannels, totalFrames, targetRate)

      let offset = 0
      for (const buffer of buffers) {
        const source = offline.createBufferSource()
        source.buffer = buffer
        source.connect(offline.destination)
        source.start(offset)
        offset += buffer.duration + gap
      }

      const rendered = await offline.startRendering()

      // Yield once so the "Merging…" state paints before any heavy sync encode.
      await new Promise((resolve) => setTimeout(resolve, 0))

      const blob =
        outputFormat === 'mp3'
          ? encodeMp3(rendered, Number(mp3Bitrate) || 192)
          : encodeWav(rendered)

      const url = URL.createObjectURL(blob)
      setResult({
        url,
        name: `merged-audio.${outputFormat}`,
        size: blob.size,
        format: outputFormat,
        durationMs: rendered.duration * 1000
      })
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to merge the audio files.')
    } finally {
      setIsProcessing(false)
    }
  }

  const startOver = () => {
    clearResult()
    setErrorMessage('')
  }

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition text-slate-500 dark:text-slate-400 ${
        dragActive
          ? 'border-blue-400 bg-blue-50 text-slate-900 dark:border-blue-400/70 dark:bg-blue-600/20 dark:text-slate-200'
          : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50 dark:border-white/20 dark:hover:border-white/30 dark:hover:bg-white/5'
      }`,
    [dragActive]
  )

  const moveBtnClass =
    'rounded-md border px-2 py-1 text-xs font-semibold transition border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10'

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border p-10 text-left border-slate-300 bg-white shadow-md dark:border-white/10 dark:bg-white/5 dark:backdrop-blur dark:shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle="Preview, reorder, and combine audio files into one — entirely in your browser, no uploads." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-200 bg-red-50 text-red-700 dark:border-red-400/50 dark:bg-red-900/25 dark:text-red-200">{errorMessage}</div>
      )}

      <div className="mt-6 flex flex-col gap-5">
        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); addFiles(e.dataTransfer.files) }}
        >
          <svg className="mb-2" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
          <div className="text-sm text-slate-700 dark:text-slate-200">Drag and drop audio files here</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">or click to add — MP3, WAV, OGG, M4A, FLAC…</div>
          <input type="file" accept="audio/*" multiple disabled={isProcessing} onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} className="hidden" />
        </label>

        {tracks.length > 0 && (
          <div className="flex flex-col gap-3">
            {tracks.map((track, index) => (
              <div key={track.id} className="rounded-xl border p-3 border-slate-300 bg-slate-50 dark:border-white/10 dark:bg-slate-950/50">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <button type="button" className={moveBtnClass} onClick={() => moveTrack(index, -1)} disabled={isProcessing || index === 0} aria-label="Move up">▲</button>
                    <button type="button" className={moveBtnClass} onClick={() => moveTrack(index, 1)} disabled={isProcessing || index === tracks.length - 1} aria-label="Move down">▼</button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={track.name}>
                      <span className="mr-1 text-slate-400">{index + 1}.</span>{track.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {track.status === 'decoding' && 'Decoding…'}
                      {track.status === 'error' && <span className="text-red-600 dark:text-red-300">Could not decode — will be skipped</span>}
                      {track.status === 'ready' && `${formatTime(track.durationMs)} · ${formatBytes(track.size)}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTrack(track.id)}
                    disabled={isProcessing}
                    className="rounded-md border px-2 py-1 text-xs font-semibold transition border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                  >
                    Remove
                  </button>
                </div>
                <audio className="mt-2 h-9 w-full" controls preload="metadata" src={track.url} />
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Output format</label>
            <select className={inputClass} value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'wav' | 'mp3')} disabled={isProcessing}>
              <option value="wav">WAV (lossless)</option>
              <option value="mp3">MP3 (compressed)</option>
            </select>
          </div>
          {outputFormat === 'mp3' ? (
            <div>
              <label className={labelClass}>MP3 bitrate</label>
              <select className={inputClass} value={mp3Bitrate} onChange={(e) => setMp3Bitrate(e.target.value)} disabled={isProcessing}>
                <option value="128">128 kbps</option>
                <option value="192">192 kbps</option>
                <option value="256">256 kbps</option>
                <option value="320">320 kbps</option>
              </select>
            </div>
          ) : (
            <div>
              <label className={labelClass}>Gap between tracks (sec)</label>
              <input className={inputClass} type="number" min="0" step="0.1" value={gapSeconds} onChange={(e) => setGapSeconds(e.target.value)} disabled={isProcessing} />
            </div>
          )}
          {outputFormat === 'mp3' && (
            <div>
              <label className={labelClass}>Gap between tracks (sec)</label>
              <input className={inputClass} type="number" min="0" step="0.1" value={gapSeconds} onChange={(e) => setGapSeconds(e.target.value)} disabled={isProcessing} />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={mergeAndExport}
          disabled={isProcessing || readyTracks.length < 2}
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        >
          {isProcessing
            ? 'Merging…'
            : `Merge ${readyTracks.length || ''} file${readyTracks.length === 1 ? '' : 's'} → ${outputFormat.toUpperCase()}`}
        </button>

        {readyTracks.length < 2 && tracks.length > 0 && decodingCount === 0 && (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">Add at least two playable files to enable merging.</p>
        )}

        {result && (
          <div className="rounded-2xl border p-5 border-emerald-300 bg-emerald-50 dark:border-emerald-400/40 dark:bg-emerald-900/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{result.name}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {formatTime(result.durationMs)} · {formatBytes(result.size)} · {result.format.toUpperCase()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-700" href={result.url} download={result.name}>
                  Download
                </a>
                <button type="button" onClick={startOver} className="rounded-lg border px-3 py-2 text-xs font-semibold transition border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10">
                  Clear result
                </button>
              </div>
            </div>
            <audio className="mt-3 w-full" controls preload="metadata" src={result.url} />
          </div>
        )}
      </div>
    </div>
  )
}

export default MergeAudioView
