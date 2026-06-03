import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type ImageCollageViewProps = {
  tool: Tool
}

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white'

type Thumb = { file: File; url: string }

function ImageCollageView({ tool }: ImageCollageViewProps) {
  const [thumbs, setThumbs] = useState<Thumb[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [columns, setColumns] = useState('')
  const [tileWidth, setTileWidth] = useState('320')
  const [tileHeight, setTileHeight] = useState('320')
  const [spacing, setSpacing] = useState('12')
  const [background, setBackground] = useState('#ffffff')

  useEffect(() => () => thumbs.forEach((t) => URL.revokeObjectURL(t.url)), [thumbs])

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition text-slate-400 ${
        dragActive
          ? 'border-blue-400/70 bg-blue-600/20 text-slate-200'
          : 'border-white/20 hover:border-white/30 hover:bg-white/5'
      }`,
    [dragActive]
  )

  const addFiles = (files: FileList | null) => {
    const incoming = Array.from(files || []).filter((f) => f.type.startsWith('image/'))
    if (!incoming.length) return
    setThumbs((prev) => [...prev, ...incoming.map((file) => ({ file, url: URL.createObjectURL(file) }))])
    setErrorMessage('')
  }

  const removeAt = (index: number) => {
    setThumbs((prev) => {
      const next = [...prev]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.url)
      return next
    })
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (thumbs.length < 2) {
      setErrorMessage('Select at least two images to build a collage.')
      return
    }

    setIsProcessing(true)
    setErrorMessage('')
    const data = new FormData()
    thumbs.forEach((t) => data.append('files', t.file))
    if (columns && Number(columns) > 0) data.append('columns', columns)
    data.append('tileWidth', tileWidth)
    data.append('tileHeight', tileHeight)
    data.append('spacing', spacing)
    data.append('background', background)

    try {
      const response = await fetch(tool.apiEndpoint as string, { method: 'POST', body: data })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || response.statusText)
      }
      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      const filename = match ? match[1] : 'collage_grid.png'

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
      setErrorMessage(err instanceof Error ? err.message : 'Collage creation failed.')
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

      <FeatureHeader tool={tool} subtitle="Compose many images into one grid — assembled by the local Go engine." />

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
            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
          </svg>
          <div className="text-sm text-slate-200">{thumbs.length ? `${thumbs.length} image${thumbs.length === 1 ? '' : 's'} selected` : 'Drag and drop images here'}</div>
          <div className="mt-2 text-xs text-slate-400">or click to add more images</div>
          <input type="file" accept="image/*" multiple disabled={isProcessing} onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} className="hidden" />
        </label>

        {thumbs.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {thumbs.map((t, index) => (
              <div key={t.url} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10">
                <img src={t.url} alt={t.file.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  disabled={isProcessing}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs font-bold text-white opacity-0 transition group-hover:opacity-100"
                  aria-label={`Remove ${t.file.name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Columns (optional)</label>
            <input className={inputClass} type="number" min="1" placeholder="auto" value={columns} onChange={(e) => setColumns(e.target.value)} disabled={isProcessing} />
          </div>
          <div>
            <label className={labelClass}>Spacing (px)</label>
            <input className={inputClass} type="number" min="0" value={spacing} onChange={(e) => setSpacing(e.target.value)} disabled={isProcessing} />
          </div>
          <div>
            <label className={labelClass}>Tile width (px)</label>
            <input className={inputClass} type="number" min="1" value={tileWidth} onChange={(e) => setTileWidth(e.target.value)} disabled={isProcessing} />
          </div>
          <div>
            <label className={labelClass}>Tile height (px)</label>
            <input className={inputClass} type="number" min="1" value={tileHeight} onChange={(e) => setTileHeight(e.target.value)} disabled={isProcessing} />
          </div>
        </div>

        <div>
          <label className={labelClass}>Background color</label>
          <div className="flex items-center gap-3">
            <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} disabled={isProcessing} className="h-10 w-14 cursor-pointer rounded-lg border border-slate-800 bg-slate-900/70" />
            <input className={inputClass} type="text" value={background} onChange={(e) => setBackground(e.target.value)} disabled={isProcessing} />
          </div>
        </div>

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || thumbs.length < 2}
        >
          {isProcessing ? 'Building collage...' : 'Build Collage'}
        </button>
      </form>
    </div>
  )
}

export default ImageCollageView
