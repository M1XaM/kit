import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type ImageWatermarkViewProps = {
  tool: Tool
}

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white'

const POSITIONS = [
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'center', label: 'Center' },
  { value: 'tile', label: 'Tile (repeat)' }
]

function ImageWatermarkView({ tool }: ImageWatermarkViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [watermarkImage, setWatermarkImage] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [wmType, setWmType] = useState('text')
  const [text, setText] = useState('© Kit')
  const [position, setPosition] = useState('bottom-right')
  const [opacity, setOpacity] = useState('50')
  const [fontSize, setFontSize] = useState('')
  const [color, setColor] = useState('#ffffff')
  const [scale, setScale] = useState('25')

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) {
      setErrorMessage('Select an image first.')
      return
    }
    if (wmType === 'text' && !text.trim()) {
      setErrorMessage('Enter the watermark text.')
      return
    }
    if (wmType === 'image' && !watermarkImage) {
      setErrorMessage('Choose a watermark image.')
      return
    }

    const data = new FormData()
    data.append('image', file)
    data.append('type', wmType)
    data.append('position', position)
    data.append('opacity', opacity)
    if (wmType === 'text') {
      data.append('text', text.trim())
      data.append('color', color)
      if (fontSize && Number(fontSize) > 0) data.append('fontSize', fontSize)
    } else {
      data.append('watermark', watermarkImage as File)
      data.append('scale', scale)
    }

    setIsProcessing(true)
    setErrorMessage('')
    try {
      const response = await fetch(tool.apiEndpoint as string, { method: 'POST', body: data })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || response.statusText)
      }

      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      const filename = match ? match[1] : `${stripExtension(file.name)}_watermarked.png`

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

      <FeatureHeader tool={tool} subtitle="Stamp text or a logo onto your image — processed by the local Go engine." />

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
            <img src={previewUrl} alt="Selected preview" className="mb-3 max-h-48 rounded-lg object-contain" />
          ) : (
            <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          )}
          <div className="text-sm text-slate-200">{file ? file.name : 'Drag and drop an image here'}</div>
          <div className="mt-2 text-xs text-slate-400">or click to choose an image</div>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={(e) => pickFile(e.target.files)}
            className="hidden"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Watermark type</label>
            <select className={inputClass} value={wmType} onChange={(e) => setWmType(e.target.value)} disabled={isProcessing}>
              <option value="text">Text</option>
              <option value="image">Image / logo</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Position</label>
            <select className={inputClass} value={position} onChange={(e) => setPosition(e.target.value)} disabled={isProcessing}>
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {wmType === 'text' ? (
          <>
            <div>
              <label className={labelClass}>Text</label>
              <input className={inputClass} type="text" value={text} onChange={(e) => setText(e.target.value)} disabled={isProcessing} placeholder="© Your name" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Font size (px, optional)</label>
                <input className={inputClass} type="number" min="8" max="512" placeholder="auto" value={fontSize} onChange={(e) => setFontSize(e.target.value)} disabled={isProcessing} />
              </div>
              <div>
                <label className={labelClass}>Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={isProcessing} className="h-10 w-14 cursor-pointer rounded-lg border border-slate-800 bg-slate-900/70" />
                  <input className={inputClass} type="text" value={color} onChange={(e) => setColor(e.target.value)} disabled={isProcessing} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className={labelClass}>Watermark image (transparent PNG works best)</label>
              <input
                className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
                type="file"
                accept="image/*"
                disabled={isProcessing}
                onChange={(e) => setWatermarkImage(e.target.files?.[0] || null)}
              />
            </div>
            <div>
              <label className={labelClass}>Size: {scale}% of the image width</label>
              <input type="range" className="w-full accent-blue-600" min="1" max="100" value={scale} onChange={(e) => setScale(e.target.value)} disabled={isProcessing} />
            </div>
          </>
        )}

        <div>
          <label className={labelClass}>Opacity: {opacity}%</label>
          <input type="range" className="w-full accent-blue-600" min="0" max="100" value={opacity} onChange={(e) => setOpacity(e.target.value)} disabled={isProcessing} />
        </div>

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !file}
        >
          {isProcessing ? 'Processing...' : 'Watermark Image'}
        </button>
      </form>
    </div>
  )
}

export default ImageWatermarkView
