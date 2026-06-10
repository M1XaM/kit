import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type BatchImageViewProps = {
  tool: Tool
}

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white'

const CONVERT_FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'gif', label: 'GIF' },
  { value: 'bmp', label: 'BMP' },
  { value: 'tiff', label: 'TIFF' }
]

const formatBytes = (value: number) => {
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

function BatchImageView({ tool }: BatchImageViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [operation, setOperation] = useState('convert')
  const [format, setFormat] = useState('jpeg')
  const [quality, setQuality] = useState('85')
  const [resizeMode, setResizeMode] = useState('fit')
  const [width, setWidth] = useState('1280')
  const [height, setHeight] = useState('')
  const [percent, setPercent] = useState('50')
  const [maxWidth, setMaxWidth] = useState('')

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition text-slate-400 ${
        dragActive
          ? 'border-blue-400/70 bg-blue-600/20 text-slate-200'
          : 'border-white/20 hover:border-white/30 hover:bg-white/5'
      }`,
    [dragActive]
  )

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return
    const next = Array.from(incoming).filter((f) => f.type.startsWith('image/') || f.type === '')
    setFiles((prev) => [...prev, ...next])
    setErrorMessage('')
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const buildFormData = (): FormData | string => {
    const data = new FormData()
    files.forEach((f) => data.append('files', f))
    data.append('operation', operation)

    switch (operation) {
      case 'convert': {
        data.append('format', format)
        data.append('quality', quality)
        break
      }
      case 'resize': {
        if (resizeMode === 'percent') {
          if (!percent || Number(percent) <= 0) return 'Enter a percentage greater than zero.'
          data.append('percent', percent)
        } else {
          if ((!width || Number(width) <= 0) && (!height || Number(height) <= 0)) {
            return 'Enter a width and/or height.'
          }
          if (width) data.append('width', width)
          if (height) data.append('height', height)
        }
        break
      }
      case 'compress': {
        data.append('quality', quality)
        data.append('format', format === 'png' ? 'png' : 'jpeg')
        if (maxWidth && Number(maxWidth) > 0) data.append('maxWidth', maxWidth)
        break
      }
    }
    return data
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!files.length) {
      setErrorMessage('Add at least one image.')
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
        const message = await response.text()
        throw new Error(message || response.statusText)
      }

      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      const filename = match ? match[1] : 'batch_images.zip'

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

  const showQuality = operation === 'compress' || (operation === 'convert' && format === 'jpeg')

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle="Apply one operation to many images at once and download the results as a ZIP — processed by the local Go engine." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <form className="mt-6 flex flex-col gap-5" onSubmit={handleSubmit}>
        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); addFiles(e.dataTransfer.files) }}
        >
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <div className="text-sm text-slate-200">
            {files.length ? `${files.length} image${files.length === 1 ? '' : 's'} selected` : 'Drag and drop images here'}
          </div>
          <div className="mt-2 text-xs text-slate-400">or click to choose images — you can add more later</div>
          <input
            type="file"
            accept="image/*"
            multiple
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
            className="hidden"
          />
        </label>

        {files.length > 0 && (
          <div className="max-h-44 overflow-auto rounded-xl border border-white/10 bg-slate-950/60">
            {files.map((f, index) => (
              <div key={`${f.name}-${index}`} className="flex items-center justify-between gap-3 border-b px-4 py-2 text-sm border-white/5 last:border-b-0">
                <span className="truncate text-slate-200">{f.name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-slate-400 transition hover:text-red-300"
                    onClick={() => removeFile(index)}
                    disabled={isProcessing}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div>
          <label className={labelClass}>Operation</label>
          <select className={inputClass} value={operation} onChange={(e) => setOperation(e.target.value)} disabled={isProcessing}>
            <option value="convert">Convert format</option>
            <option value="resize">Resize</option>
            <option value="compress">Compress</option>
          </select>
        </div>

        {operation === 'convert' && (
          <div>
            <label className={labelClass}>Output format</label>
            <select className={inputClass} value={format} onChange={(e) => setFormat(e.target.value)} disabled={isProcessing}>
              {CONVERT_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        )}

        {operation === 'resize' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>Mode</label>
              <select className={inputClass} value={resizeMode} onChange={(e) => setResizeMode(e.target.value)} disabled={isProcessing}>
                <option value="fit">Fit within (keep aspect ratio)</option>
                <option value="percent">Scale by percentage</option>
              </select>
            </div>
            {resizeMode === 'percent' ? (
              <div>
                <label className={labelClass}>Percentage</label>
                <input className={inputClass} type="number" min="1" value={percent} onChange={(e) => setPercent(e.target.value)} disabled={isProcessing} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Width (px)</label>
                  <input className={inputClass} type="number" min="0" placeholder="auto" value={width} onChange={(e) => setWidth(e.target.value)} disabled={isProcessing} />
                </div>
                <div>
                  <label className={labelClass}>Height (px)</label>
                  <input className={inputClass} type="number" min="0" placeholder="auto" value={height} onChange={(e) => setHeight(e.target.value)} disabled={isProcessing} />
                </div>
              </div>
            )}
          </div>
        )}

        {operation === 'compress' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Output format</label>
              <select className={inputClass} value={format === 'png' ? 'png' : 'jpeg'} onChange={(e) => setFormat(e.target.value)} disabled={isProcessing}>
                <option value="jpeg">JPEG (smallest)</option>
                <option value="png">PNG (lossless)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Max width (px, optional)</label>
              <input className={inputClass} type="number" min="0" placeholder="no limit" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} disabled={isProcessing} />
            </div>
          </div>
        )}

        {showQuality && (
          <div>
            <label className={labelClass}>JPEG quality: {quality}</label>
            <input
              type="range"
              className="w-full accent-blue-600"
              min="1"
              max="100"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              disabled={isProcessing}
            />
          </div>
        )}

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !files.length}
        >
          {isProcessing ? 'Processing...' : `Process ${files.length || ''} Image${files.length === 1 ? '' : 's'} → ZIP`}
        </button>
      </form>
    </div>
  )
}

export default BatchImageView
