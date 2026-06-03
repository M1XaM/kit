import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type Mode = 'image-to-pdf' | 'pdf-to-images'

const MODES: { value: Mode; label: string }[] = [
  { value: 'image-to-pdf', label: 'Images → PDF' },
  { value: 'pdf-to-images', label: 'PDF → Images' }
]

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

type FileConverterViewProps = {
  tool: Tool
}

function FileConverterView({ tool }: FileConverterViewProps) {
  const [mode, setMode] = useState<Mode>('image-to-pdf')
  const isImageToPdf = mode === 'image-to-pdf'
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition text-slate-400 ${
        dragActive
          ? 'border-blue-400/70 bg-blue-600/20 text-slate-200'
          : 'border-white/20 hover:border-white/30 hover:bg-white/5'
      }`,
    [dragActive]
  )

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setMode(next)
    setSelectedFiles([])
    setErrorMessage('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const updateFiles = (files: File[]) => {
    if (!files.length) return
    setSelectedFiles(isImageToPdf ? files : files.slice(0, 1))
    setErrorMessage('')
  }

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(false)
    updateFiles(Array.from(event.dataTransfer.files || []))
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    updateFiles(Array.from(event.target.files || []))
  }

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedFiles.length) {
      setErrorMessage(isImageToPdf ? 'Select at least one image.' : 'Please select a PDF first.')
      return
    }

    setIsProcessing(true)
    setErrorMessage('')

    const formData = new FormData()
    const base = stripExtension(selectedFiles[0].name)
    let endpoint: string
    let fallbackName: string

    if (isImageToPdf) {
      selectedFiles.forEach((file) => formData.append('files', file))
      endpoint = '/api/convert/image-to-pdf'
      fallbackName = `${selectedFiles.length === 1 ? base : 'images'}.pdf`
    } else {
      formData.append('file', selectedFiles[0])
      formData.append('image', selectedFiles[0])
      endpoint = '/api/convert/pdf-to-images'
      fallbackName = `${base}_images.zip`
    }

    try {
      const response = await fetch(endpoint, { method: 'POST', body: formData })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || response.statusText)
      }
      await downloadResponse(response, fallbackName)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Conversion failed.')
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

      <FeatureHeader tool={tool} subtitle="Convert images to a PDF and back, locally on your machine." />

      <div className="mt-6 inline-flex rounded-lg border p-1 border-white/10 bg-white/5">
        {MODES.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => switchMode(option.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${
              mode === option.value
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <form className="mt-6 flex flex-col gap-5" onSubmit={handleSubmit}>
        <label className={dropZoneClass} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div className="text-sm text-slate-200">
            {selectedFiles.length
              ? isImageToPdf
                ? `${selectedFiles.length} image${selectedFiles.length === 1 ? '' : 's'} selected`
                : selectedFiles[0].name
              : isImageToPdf
                ? 'Drag and drop images here'
                : 'Drag and drop a PDF here'}
          </div>
          <div className="mt-2 text-xs text-slate-400">or click to choose {isImageToPdf ? 'images' : 'a file'}</div>
          <input
            type="file"
            accept={isImageToPdf ? 'image/*' : 'application/pdf'}
            multiple={isImageToPdf}
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {isImageToPdf && selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map((file, index) => (
              <span key={`${file.name}-${index}`} className="rounded-full border px-3 py-1 text-xs border-white/20 bg-slate-900/60 text-slate-200">
                {index + 1}. {file.name}
              </span>
            ))}
          </div>
        )}

        {!isImageToPdf && (
          <div className="text-xs text-slate-400">
            Extracts images embedded in the PDF (works great for PDFs built from images). Text or vector-only pages contain no embedded images to extract.
          </div>
        )}

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !selectedFiles.length}
        >
          {isProcessing ? 'Converting...' : isImageToPdf ? 'Convert to PDF' : 'Extract Images'}
        </button>
      </form>
    </div>
  )
}

export default FileConverterView
