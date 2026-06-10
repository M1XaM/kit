import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type VideoToolViewProps = {
  tool: Tool
}

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white'

const CONVERT_FORMATS = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'mkv', label: 'MKV (H.264)' },
  { value: 'mov', label: 'MOV (H.264)' },
  { value: 'gif', label: 'Animated GIF' }
]

const AUDIO_FORMATS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV (lossless)' },
  { value: 'flac', label: 'FLAC (lossless)' },
  { value: 'ogg', label: 'OGG Vorbis' },
  { value: 'opus', label: 'Opus' },
  { value: 'm4a', label: 'M4A (AAC)' },
  { value: 'aac', label: 'AAC' }
]

const LOSSY_AUDIO_FORMATS = new Set(['mp3', 'ogg', 'opus', 'm4a', 'aac'])

// Per-tool copy and whether the tool consumes audio rather than video.
const TOOL_META: Record<string, { subtitle: string; audio?: boolean }> = {
  'trim-video': { subtitle: 'Cut a clip to an exact start and end — fast, lossless stream copy.' },
  'split-video': { subtitle: 'Slice a video into multiple clips and download them as a ZIP.' },
  'resize-video': { subtitle: 'Rescale a video to new dimensions while keeping it playable everywhere.' },
  'compress-video': { subtitle: 'Shrink a video with adjustable quality, optionally downscaling first.' },
  'convert-video': { subtitle: 'Transcode a video to another format right on your machine.' },
  'trim-audio': { subtitle: 'Cut an audio clip to an exact start and end.', audio: true },
  'adjust-audio': { subtitle: 'Re-encode audio with a new bitrate and/or sample rate.', audio: true },
  'convert-audio': { subtitle: 'Transcode audio to another format right on your machine.', audio: true }
}

const BITRATES = ['64', '96', '128', '160', '192', '256', '320']
const SAMPLE_RATES = [
  { value: '8000', label: '8 kHz' },
  { value: '16000', label: '16 kHz' },
  { value: '22050', label: '22.05 kHz' },
  { value: '32000', label: '32 kHz' },
  { value: '44100', label: '44.1 kHz' },
  { value: '48000', label: '48 kHz' },
  { value: '96000', label: '96 kHz' }
]

function VideoToolView({ tool }: VideoToolViewProps) {
  const meta = TOOL_META[tool.id] || { subtitle: tool.description }
  const isAudio = !!meta.audio

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Trim controls
  const [start, setStart] = useState('0:00')
  const [end, setEnd] = useState('0:10')

  // Split controls
  const [splitMode, setSplitMode] = useState('parts')
  const [parts, setParts] = useState('3')
  const [interval, setInterval] = useState('30')

  // Resize controls
  const [width, setWidth] = useState('1280')
  const [height, setHeight] = useState('')

  // Compress controls
  const [quality, setQuality] = useState('60')
  const [maxWidth, setMaxWidth] = useState('')

  // Convert controls
  const [format, setFormat] = useState('mp4')

  // Adjust audio controls
  const [bitrate, setBitrate] = useState('192')
  const [sampleRate, setSampleRate] = useState('44100')

  // Convert audio controls
  const [audioFormat, setAudioFormat] = useState('mp3')

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition text-slate-400 ${
        dragActive
          ? 'border-blue-400/70 bg-blue-600/20 text-slate-200'
          : 'border-white/20 hover:border-white/30 hover:bg-white/5'
      }`,
    [dragActive]
  )

  const pickFile = (files: FileList | null) => {
    const next = files?.[0]
    if (!next) return
    setFile(next)
    setErrorMessage('')
  }

  const buildFormData = (): FormData | string => {
    const data = new FormData()
    data.append('file', file as File)

    switch (tool.id) {
      case 'trim-video':
      case 'trim-audio': {
        if (!end.trim()) return 'Enter an end time.'
        data.append('start', start.trim() || '0')
        data.append('end', end.trim())
        break
      }
      case 'split-video': {
        data.append('mode', splitMode)
        if (splitMode === 'parts') {
          if (!parts || Number(parts) < 2) return 'Enter at least 2 parts.'
          data.append('parts', parts)
        } else {
          if (!interval || Number(interval) <= 0) return 'Enter a clip length greater than zero.'
          data.append('interval', interval)
        }
        break
      }
      case 'resize-video': {
        if ((!width || Number(width) <= 0) && (!height || Number(height) <= 0)) {
          return 'Enter a width and/or height.'
        }
        if (width) data.append('width', width)
        if (height) data.append('height', height)
        break
      }
      case 'compress-video': {
        data.append('quality', quality)
        if (maxWidth && Number(maxWidth) > 0) data.append('maxWidth', maxWidth)
        break
      }
      case 'convert-video': {
        data.append('format', format)
        break
      }
      case 'adjust-audio': {
        if (!bitrate && !sampleRate) return 'Choose a bitrate and/or sample rate.'
        if (bitrate) data.append('bitrate', bitrate)
        if (sampleRate) data.append('sampleRate', sampleRate)
        break
      }
      case 'convert-audio': {
        data.append('format', audioFormat)
        if (LOSSY_AUDIO_FORMATS.has(audioFormat) && bitrate) data.append('bitrate', bitrate)
        break
      }
    }
    return data
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) {
      setErrorMessage(`Select ${isAudio ? 'an audio file' : 'a video'} first.`)
      return
    }

    const built = buildFormData()
    if (typeof built === 'string') {
      setErrorMessage(built)
      return
    }

    setIsProcessing(true)
    setErrorMessage('')
    try {
      const response = await fetch(tool.apiEndpoint as string, { method: 'POST', body: built })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || response.statusText)
      }

      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      const filename = match ? match[1] : `${stripExtension(file.name)}_${tool.id}`

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Processing failed.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle={meta.subtitle} />

      <p className="mt-3 text-xs text-slate-500">Processed locally by the Go backend using ffmpeg — nothing is uploaded to the cloud.</p>

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <form className="mt-6 flex flex-col gap-5" onSubmit={handleSubmit}>
        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); pickFile(e.dataTransfer.files) }}
        >
          {previewUrl ? (
            isAudio ? (
              <audio src={previewUrl} controls className="mb-3 w-full" onClick={(e) => e.preventDefault()} />
            ) : (
              <video src={previewUrl} controls className="mb-3 max-h-56 rounded-lg" onClick={(e) => e.preventDefault()} />
            )
          ) : (
            <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"></polygon>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
          )}
          <div className="text-sm text-slate-200">{file ? file.name : `Drag and drop ${isAudio ? 'an audio file' : 'a video'} here`}</div>
          <div className="mt-2 text-xs text-slate-400">or click to choose a file</div>
          <input
            type="file"
            accept={isAudio ? 'audio/*' : 'video/*'}
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={(e) => pickFile(e.target.files)}
            className="hidden"
          />
        </label>

        {(tool.id === 'trim-video' || tool.id === 'trim-audio') && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start (mm:ss)</label>
              <input className={inputClass} type="text" placeholder="0:00" value={start} onChange={(e) => setStart(e.target.value)} disabled={isProcessing} />
            </div>
            <div>
              <label className={labelClass}>End (mm:ss)</label>
              <input className={inputClass} type="text" placeholder="0:10" value={end} onChange={(e) => setEnd(e.target.value)} disabled={isProcessing} />
            </div>
          </div>
        )}

        {tool.id === 'split-video' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>Split mode</label>
              <select className={inputClass} value={splitMode} onChange={(e) => setSplitMode(e.target.value)} disabled={isProcessing}>
                <option value="parts">Into equal parts</option>
                <option value="interval">Every N seconds</option>
              </select>
            </div>
            {splitMode === 'parts' ? (
              <div>
                <label className={labelClass}>Number of parts</label>
                <input className={inputClass} type="number" min="2" max="100" value={parts} onChange={(e) => setParts(e.target.value)} disabled={isProcessing} />
              </div>
            ) : (
              <div>
                <label className={labelClass}>Clip length (seconds)</label>
                <input className={inputClass} type="number" min="1" value={interval} onChange={(e) => setInterval(e.target.value)} disabled={isProcessing} />
              </div>
            )}
            <p className="text-xs text-slate-500">Clips are re-encoded to MP4 and delivered as a ZIP archive.</p>
          </div>
        )}

        {tool.id === 'resize-video' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Width (px)</label>
              <input className={inputClass} type="number" min="0" placeholder="auto" value={width} onChange={(e) => setWidth(e.target.value)} disabled={isProcessing} />
            </div>
            <div>
              <label className={labelClass}>Height (px)</label>
              <input className={inputClass} type="number" min="0" placeholder="auto" value={height} onChange={(e) => setHeight(e.target.value)} disabled={isProcessing} />
            </div>
            <p className="col-span-2 text-xs text-slate-500">Leave one field empty to keep the original aspect ratio.</p>
          </div>
        )}

        {tool.id === 'compress-video' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>Quality: {quality}</label>
              <input
                type="range"
                className="w-full accent-blue-600"
                min="0"
                max="100"
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                disabled={isProcessing}
              />
              <p className="mt-1 text-xs text-slate-500">Higher quality keeps more detail; lower quality makes a smaller file.</p>
            </div>
            <div>
              <label className={labelClass}>Max width (px, optional)</label>
              <input className={inputClass} type="number" min="0" placeholder="no limit" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} disabled={isProcessing} />
            </div>
          </div>
        )}

        {tool.id === 'convert-video' && (
          <div>
            <label className={labelClass}>Output format</label>
            <select className={inputClass} value={format} onChange={(e) => setFormat(e.target.value)} disabled={isProcessing}>
              {CONVERT_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        )}

        {tool.id === 'convert-audio' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Output format</label>
              <select className={inputClass} value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)} disabled={isProcessing}>
                {AUDIO_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
            {LOSSY_AUDIO_FORMATS.has(audioFormat) && (
              <div>
                <label className={labelClass}>Bitrate (kbps)</label>
                <select className={inputClass} value={bitrate} onChange={(e) => setBitrate(e.target.value)} disabled={isProcessing}>
                  {BITRATES.map((b) => (
                    <option key={b} value={b}>{b} kbps</option>
                  ))}
                </select>
              </div>
            )}
            <p className="col-span-2 text-xs text-slate-500">Video files work too — the audio track is extracted and converted.</p>
          </div>
        )}

        {tool.id === 'adjust-audio' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Bitrate (kbps)</label>
                <select className={inputClass} value={bitrate} onChange={(e) => setBitrate(e.target.value)} disabled={isProcessing}>
                  {BITRATES.map((b) => (
                    <option key={b} value={b}>{b} kbps</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Sample rate</label>
                <select className={inputClass} value={sampleRate} onChange={(e) => setSampleRate(e.target.value)} disabled={isProcessing}>
                  {SAMPLE_RATES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-500">Bitrate is applied to lossy formats (MP3, AAC, OGG, Opus); sample rate applies to all.</p>
          </div>
        )}

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !file}
        >
          {isProcessing ? 'Processing...' : isAudio ? 'Process Audio' : 'Process Video'}
        </button>
      </form>
    </div>
  )
}

export default VideoToolView
