import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import FileReorderList from './FileReorderList'
import type { Tool } from './toolData'

// Universal file converter: drop any mix-of-one-kind files (images, audio,
// video or PDFs) and convert them to any compatible target format. Dedicated
// per-format tools still exist; this page is the catch-all that routes each
// job to the right local engine:
//
//   images → png/jpeg/gif/bmp/tiff   /api/image/convert (ZIP when several)
//   images → one PDF (in list order) /api/convert/image-to-pdf
//   audio  → mp3/wav/flac/ogg/...    /api/audio/convert (per file, ffmpeg)
//   video  → mp4/webm/mkv/mov/gif    /api/video/convert (per file, ffmpeg)
//   video  → audio formats           /api/audio/convert (extracts the track)
//   PDF    → page images (ZIP)       /api/convert/pdf-to-images

type Kind = 'image' | 'audio' | 'video' | 'pdf' | 'unknown'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'wma'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp', 'ts'])

const fileKind = (file: File): Kind => {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type === 'application/pdf') return 'pdf'
  return 'unknown'
}

type TargetOption = { value: string; label: string }

const TARGETS: Record<Exclude<Kind, 'unknown'>, TargetOption[]> = {
  image: [
    { value: 'png', label: 'PNG' },
    { value: 'jpeg', label: 'JPEG' },
    { value: 'gif', label: 'GIF' },
    { value: 'bmp', label: 'BMP' },
    { value: 'tiff', label: 'TIFF' },
    { value: 'pdf', label: 'PDF (all images → one document)' }
  ],
  audio: [
    { value: 'mp3', label: 'MP3' },
    { value: 'wav', label: 'WAV (lossless)' },
    { value: 'flac', label: 'FLAC (lossless)' },
    { value: 'ogg', label: 'OGG Vorbis' },
    { value: 'opus', label: 'Opus' },
    { value: 'm4a', label: 'M4A (AAC)' },
    { value: 'aac', label: 'AAC' }
  ],
  video: [
    { value: 'mp4', label: 'MP4 (H.264)' },
    { value: 'webm', label: 'WebM (VP9)' },
    { value: 'mkv', label: 'MKV (H.264)' },
    { value: 'mov', label: 'MOV (H.264)' },
    { value: 'gif', label: 'Animated GIF' },
    { value: 'audio:mp3', label: 'MP3 (audio only)' },
    { value: 'audio:wav', label: 'WAV (audio only)' },
    { value: 'audio:m4a', label: 'M4A (audio only)' }
  ],
  pdf: [
    { value: 'png', label: 'PNG page images (ZIP)' },
    { value: 'jpeg', label: 'JPEG page images (ZIP)' }
  ]
}

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

const downloadResponse = async (response: Response, fallback: string) => {
  let filename = fallback
  const disposition = response.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="?([^";]+)"?/i)
  if (match) filename = match[1]

  const blob = await response.blob()
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}

const postForm = async (endpoint: string, build: (data: FormData) => void): Promise<Response> => {
  const data = new FormData()
  build(data)
  const response = await fetch(endpoint, { method: 'POST', body: data })
  if (!response.ok) {
    throw new Error((await response.text()) || response.statusText)
  }
  return response
}

type FileConverterViewProps = {
  tool: Tool
}

function FileConverterView({ tool }: FileConverterViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [target, setTarget] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const kinds = useMemo(() => new Set(files.map(fileKind)), [files])
  const kind: Kind | 'mixed' | null = files.length === 0
    ? null
    : kinds.size > 1
      ? 'mixed'
      : [...kinds][0]

  const targetOptions = kind && kind !== 'mixed' && kind !== 'unknown' ? TARGETS[kind] : []

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition text-slate-400 ${
        dragActive
          ? 'border-blue-400/70 bg-blue-600/20 text-slate-200'
          : 'border-white/20 hover:border-white/30 hover:bg-white/5'
      }`,
    [dragActive]
  )

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return
    setFiles((prev) => {
      const next = [...prev, ...incoming]
      // Re-derive a sensible default target whenever the file kind changes.
      const nextKinds = new Set(next.map(fileKind))
      if (nextKinds.size === 1) {
        const k = [...nextKinds][0]
        if (k !== 'unknown' && !TARGETS[k].some((t) => t.value === target)) {
          setTarget(TARGETS[k][0].value)
        }
      }
      return next
    })
    setErrorMessage('')
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!files.length) {
      setErrorMessage('Add at least one file.')
      return
    }
    if (kind === 'mixed') {
      setErrorMessage('Mixed file types selected — convert one kind (images, audio, video or PDFs) at a time.')
      return
    }
    if (kind === 'unknown') {
      setErrorMessage('These files are not a supported input type (images, audio, video, PDF).')
      return
    }
    if (!target) {
      setErrorMessage('Choose a target format.')
      return
    }

    setIsProcessing(true)
    setErrorMessage('')
    try {
      if (kind === 'image' && target === 'pdf') {
        setStatusText(`Combining ${files.length} image${files.length === 1 ? '' : 's'} into a PDF…`)
        const res = await postForm('/api/convert/image-to-pdf', (data) => {
          files.forEach((f) => data.append('files', f))
        })
        await downloadResponse(res, files.length === 1 ? `${stripExtension(files[0].name)}.pdf` : 'images.pdf')
      } else if (kind === 'image') {
        setStatusText(`Converting ${files.length} image${files.length === 1 ? '' : 's'} to ${target.toUpperCase()}…`)
        const res = await postForm('/api/image/convert', (data) => {
          files.forEach((f) => data.append('files', f))
          data.append('format', target)
          data.append('quality', '90')
        })
        await downloadResponse(res, files.length === 1 ? `${stripExtension(files[0].name)}.${target}` : 'converted_images.zip')
      } else if (kind === 'pdf') {
        for (let i = 0; i < files.length; i += 1) {
          setStatusText(`Rendering ${files[i].name} (${i + 1}/${files.length})…`)
          const res = await postForm('/api/convert/pdf-to-images', (data) => {
            data.append('file', files[i])
            data.append('format', target)
            data.append('dpi', '150')
          })
          await downloadResponse(res, `${stripExtension(files[i].name)}_images.zip`)
        }
      } else {
        // Audio and video transcode one file per request (ffmpeg jobs).
        const audioOnly = target.startsWith('audio:')
        const format = audioOnly ? target.slice('audio:'.length) : target
        const endpoint = kind === 'audio' || audioOnly ? '/api/audio/convert' : '/api/video/convert'
        for (let i = 0; i < files.length; i += 1) {
          setStatusText(`Converting ${files[i].name} (${i + 1}/${files.length})…`)
          const res = await postForm(endpoint, (data) => {
            data.append('file', files[i])
            data.append('format', format)
          })
          await downloadResponse(res, `${stripExtension(files[i].name)}.${format}`)
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Conversion failed.')
    } finally {
      setIsProcessing(false)
      setStatusText('')
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

      <FeatureHeader tool={tool} subtitle="One converter for everything — images, audio, video and PDFs, processed locally." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <form className="mt-6 flex flex-col gap-5" onSubmit={handleSubmit}>
        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); addFiles(Array.from(e.dataTransfer.files || [])) }}
        >
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div className="text-sm text-slate-200">
            {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected` : 'Drag and drop files here'}
          </div>
          <div className="mt-2 text-xs text-slate-400">images, audio, video or PDFs — click to choose, add more anytime</div>
          <input
            type="file"
            multiple
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }}
            className="hidden"
          />
        </label>

        {files.length > 0 && (
          <div className="flex flex-col gap-2">
            <FileReorderList
              files={files}
              disabled={isProcessing}
              onReorder={setFiles}
              onRemove={(index) => setFiles((prev) => prev.filter((_, i) => i !== index))}
            />
            {kind === 'image' && target === 'pdf' && (
              <p className="text-xs text-slate-500">Drag rows to set the page order of the PDF.</p>
            )}
          </div>
        )}

        {kind === 'mixed' && (
          <div className="rounded-xl border px-4 py-3 text-sm border-amber-400/50 bg-amber-900/25 text-amber-200">
            Mixed file types selected — convert one kind at a time.
          </div>
        )}

        {targetOptions.length > 0 && (
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400">Convert to</label>
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={isProcessing}
            >
              {targetOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {(kind === 'audio' || kind === 'video') && (
              <p className="mt-2 text-xs text-slate-500">Audio/video conversion runs through the local ffmpeg engine.</p>
            )}
            {kind === 'pdf' && (
              <p className="mt-2 text-xs text-slate-500">Pages are rendered with poppler/Ghostscript when installed; otherwise embedded images are extracted.</p>
            )}
          </div>
        )}

        {isProcessing && statusText && (
          <div className="text-sm text-slate-300">{statusText}</div>
        )}

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !files.length || kind === 'mixed' || kind === 'unknown'}
        >
          {isProcessing ? 'Converting…' : 'Convert'}
        </button>
      </form>
    </div>
  )
}

export default FileConverterView
