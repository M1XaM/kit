import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type PdfWatermarkViewProps = {
  tool: Tool
}

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white'

function PdfWatermarkView({ tool }: PdfWatermarkViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [watermarkImage, setWatermarkImage] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [wmType, setWmType] = useState('text')
  const [text, setText] = useState('CONFIDENTIAL')
  const [layer, setLayer] = useState('above')
  const [opacity, setOpacity] = useState('30')
  const [rotation, setRotation] = useState('45')
  const [color, setColor] = useState('#808080')
  const [fontSize, setFontSize] = useState('48')
  const [scale, setScale] = useState('50')
  const [pages, setPages] = useState('')

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
      setErrorMessage('Select a PDF first.')
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
    data.append('file', file)
    data.append('type', wmType)
    data.append('layer', layer)
    data.append('opacity', opacity)
    data.append('rotation', rotation)
    if (pages.trim()) data.append('pages', pages.trim())
    if (wmType === 'text') {
      data.append('text', text.trim())
      data.append('color', color)
      data.append('fontSize', fontSize)
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
      const filename = match ? match[1] : `${stripExtension(file.name)}_watermarked.pdf`

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

      <FeatureHeader tool={tool} subtitle="Stamp text or an image across PDF pages — processed by the local Go engine." />

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
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <div className="text-sm text-slate-200">{file ? file.name : 'Drag and drop a PDF here'}</div>
          <div className="mt-2 text-xs text-slate-400">or click to choose a PDF</div>
          <input
            type="file"
            accept="application/pdf"
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
              <option value="image">Image</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Layer</label>
            <select className={inputClass} value={layer} onChange={(e) => setLayer(e.target.value)} disabled={isProcessing}>
              <option value="above">Above content (stamp)</option>
              <option value="below">Behind content (watermark)</option>
            </select>
          </div>
        </div>

        {wmType === 'text' ? (
          <>
            <div>
              <label className={labelClass}>Text</label>
              <input className={inputClass} type="text" value={text} onChange={(e) => setText(e.target.value)} disabled={isProcessing} placeholder="CONFIDENTIAL" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Font size (pt)</label>
                <input className={inputClass} type="number" min="6" max="200" value={fontSize} onChange={(e) => setFontSize(e.target.value)} disabled={isProcessing} />
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
              <label className={labelClass}>Watermark image (PNG/JPG)</label>
              <input
                className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white`}
                type="file"
                accept="image/png,image/jpeg"
                disabled={isProcessing}
                onChange={(e) => setWatermarkImage(e.target.files?.[0] || null)}
              />
            </div>
            <div>
              <label className={labelClass}>Size: {scale}% of the page width</label>
              <input type="range" className="w-full accent-blue-600" min="1" max="100" value={scale} onChange={(e) => setScale(e.target.value)} disabled={isProcessing} />
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Opacity: {opacity}%</label>
            <input type="range" className="w-full accent-blue-600" min="5" max="100" value={opacity} onChange={(e) => setOpacity(e.target.value)} disabled={isProcessing} />
          </div>
          <div>
            <label className={labelClass}>Rotation (degrees)</label>
            <input className={inputClass} type="number" min="-180" max="180" value={rotation} onChange={(e) => setRotation(e.target.value)} disabled={isProcessing} />
          </div>
        </div>

        <div>
          <label className={labelClass}>Pages (optional)</label>
          <input className={inputClass} type="text" value={pages} onChange={(e) => setPages(e.target.value)} disabled={isProcessing} placeholder="Example: 1-3,5 — empty for all pages" />
        </div>

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !file}
        >
          {isProcessing ? 'Processing...' : 'Watermark PDF'}
        </button>
      </form>
    </div>
  )
}

export default PdfWatermarkView
