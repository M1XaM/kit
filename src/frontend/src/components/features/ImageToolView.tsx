import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type ImageToolViewProps = {
  tool: Tool
}

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-300 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900/70 dark:text-white'

// Per-filter amount metadata: slider bounds, default and a human label.
const FILTERS: Record<string, { label: string; amount?: { min: number; max: number; step: number; default: number; suffix: string } }> = {
  grayscale: { label: 'Grayscale' },
  sepia: { label: 'Sepia' },
  invert: { label: 'Invert' },
  brightness: { label: 'Brightness', amount: { min: -100, max: 100, step: 1, default: 20, suffix: '' } },
  contrast: { label: 'Contrast', amount: { min: -100, max: 100, step: 1, default: 20, suffix: '' } },
  saturate: { label: 'Saturation', amount: { min: -100, max: 100, step: 1, default: 30, suffix: '' } },
  blur: { label: 'Blur', amount: { min: 1, max: 50, step: 1, default: 5, suffix: 'px' } },
  sharpen: { label: 'Sharpen', amount: { min: 0, max: 100, step: 1, default: 60, suffix: '' } }
}

function ImageToolView({ tool }: ImageToolViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Resize controls
  const [resizeMode, setResizeMode] = useState('fit')
  const [width, setWidth] = useState('1280')
  const [height, setHeight] = useState('720')
  const [percent, setPercent] = useState('50')

  // Compress / format controls
  const [quality, setQuality] = useState('75')
  const [format, setFormat] = useState('keep')
  const [maxWidth, setMaxWidth] = useState('')

  // Border controls
  const [borderWidth, setBorderWidth] = useState('20')
  const [borderColor, setBorderColor] = useState('#ffffff')
  const [cornerRadius, setCornerRadius] = useState('24')

  // Filter controls
  const [filter, setFilter] = useState('grayscale')
  const [filterAmount, setFilterAmount] = useState('20')

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Keep the filter amount in sync with whichever filter is selected.
  useEffect(() => {
    const meta = FILTERS[filter]
    if (meta?.amount) setFilterAmount(String(meta.amount.default))
  }, [filter])

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition text-slate-500 dark:text-slate-400 ${
        dragActive
          ? 'border-blue-400 bg-blue-50 text-slate-900 dark:border-blue-400/70 dark:bg-blue-600/20 dark:text-slate-200'
          : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50 dark:border-white/20 dark:hover:border-white/30 dark:hover:bg-white/5'
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
    data.append('image', file as File)

    switch (tool.id) {
      case 'resize-image': {
        data.append('mode', resizeMode)
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
        data.append('format', format)
        data.append('quality', quality)
        break
      }
      case 'compress-image': {
        data.append('quality', quality)
        data.append('format', format === 'keep' ? 'jpeg' : format)
        if (maxWidth && Number(maxWidth) > 0) data.append('maxWidth', maxWidth)
        break
      }
      case 'image-borders': {
        data.append('borderWidth', borderWidth || '0')
        data.append('borderColor', borderColor)
        data.append('cornerRadius', cornerRadius || '0')
        break
      }
      case 'image-filters': {
        data.append('filter', filter)
        if (FILTERS[filter]?.amount) data.append('amount', filterAmount)
        data.append('format', format)
        data.append('quality', quality)
        break
      }
    }
    return data
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) {
      setErrorMessage('Select an image first.')
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
      const fallback = `${stripExtension(file.name)}_${tool.id}.img`
      const filename = match ? match[1] : fallback

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

  const showQuality =
    (tool.id === 'compress-image') ||
    ((tool.id === 'resize-image' || tool.id === 'image-filters') && (format === 'jpeg' || format === 'jpg'))

  return (
    <div className="mx-auto max-w-xl rounded-2xl border p-10 text-left border-slate-300 bg-white shadow-md dark:border-white/10 dark:bg-white/5 dark:backdrop-blur dark:shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle="Processed by the local Go engine — large images stay off the browser's memory budget." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-200 bg-red-50 text-red-700 dark:border-red-400/50 dark:bg-red-900/25 dark:text-red-200">{errorMessage}</div>
      )}

      <form className="mt-6 flex flex-col gap-5" onSubmit={handleSubmit}>
        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); pickFile(e.dataTransfer.files) }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="Selected preview" className="mb-3 max-h-48 rounded-lg object-contain" />
          ) : (
            <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          )}
          <div className="text-sm text-slate-700 dark:text-slate-200">{file ? file.name : 'Drag and drop an image here'}</div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">or click to choose an image</div>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={(e) => pickFile(e.target.files)}
            className="hidden"
          />
        </label>

        {tool.id === 'resize-image' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>Mode</label>
              <select className={inputClass} value={resizeMode} onChange={(e) => setResizeMode(e.target.value)} disabled={isProcessing}>
                <option value="fit">Fit within (keep aspect ratio)</option>
                <option value="exact">Exact size (stretch)</option>
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

        {tool.id === 'compress-image' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Output format</label>
              <select className={inputClass} value={format === 'keep' ? 'jpeg' : format} onChange={(e) => setFormat(e.target.value)} disabled={isProcessing}>
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

        {tool.id === 'image-borders' && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Border width (px)</label>
                <input className={inputClass} type="number" min="0" value={borderWidth} onChange={(e) => setBorderWidth(e.target.value)} disabled={isProcessing} />
              </div>
              <div>
                <label className={labelClass}>Corner radius (px)</label>
                <input className={inputClass} type="number" min="0" value={cornerRadius} onChange={(e) => setCornerRadius(e.target.value)} disabled={isProcessing} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Border color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} disabled={isProcessing} className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white dark:border-slate-800 dark:bg-slate-900/70" />
                <input className={inputClass} type="text" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} disabled={isProcessing} />
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Output is PNG so rounded corners stay transparent.</p>
          </div>
        )}

        {tool.id === 'image-filters' && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>Effect</label>
              <select className={inputClass} value={filter} onChange={(e) => setFilter(e.target.value)} disabled={isProcessing}>
                {Object.entries(FILTERS).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
            </div>
            {FILTERS[filter]?.amount && (
              <div>
                <label className={labelClass}>
                  Amount: {filterAmount}{FILTERS[filter].amount?.suffix}
                </label>
                <input
                  type="range"
                  className="w-full accent-blue-600"
                  min={FILTERS[filter].amount?.min}
                  max={FILTERS[filter].amount?.max}
                  step={FILTERS[filter].amount?.step}
                  value={filterAmount}
                  onChange={(e) => setFilterAmount(e.target.value)}
                  disabled={isProcessing}
                />
              </div>
            )}
          </div>
        )}

        {(tool.id === 'resize-image' || tool.id === 'image-filters') && (
          <div>
            <label className={labelClass}>Output format</label>
            <select className={inputClass} value={format} onChange={(e) => setFormat(e.target.value)} disabled={isProcessing}>
              <option value="keep">Keep original</option>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
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
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !file}
        >
          {isProcessing ? 'Processing...' : 'Process Image'}
        </button>
      </form>
    </div>
  )
}

export default ImageToolView
