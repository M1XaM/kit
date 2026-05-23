import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const ARCHIVE_FORMATS = [
  { value: 'zip', label: 'ZIP (.zip)' },
  { value: 'tar', label: 'TAR (.tar)' },
  { value: 'tar.gz', label: 'TAR.GZ (.tar.gz)' },
  { value: '7z', label: '7Z (.7z)' },
  { value: 'rar', label: 'RAR (.rar)' }
]

const ARCHIVE_ACCEPT = '.zip,.tar,.gz,.tgz,.rar,.7z'

function ArchiveToolView({ tool }) {
  const isCreate = tool.id === 'archive-create'
  const [selectedFiles, setSelectedFiles] = useState([])
  const [format, setFormat] = useState('zip')
  const [isProcessing, setIsProcessing] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const fileInputRef = useRef(null)
  const dropZoneClass = `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center text-slate-400 transition ${dragActive ? 'border-blue-400/70 bg-blue-600/20 text-slate-200' : 'border-white/20 hover:border-white/30 hover:bg-white/5'}`

  const normalizeFiles = (files) => (isCreate ? files : files.slice(0, 1))

  const updateFiles = (files) => {
    const normalized = normalizeFiles(files)
    setSelectedFiles(normalized)
    setErrorMessage('')
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    setDragActive(true)
  }

  const handleDragLeave = (event) => {
    event.preventDefault()
    setDragActive(false)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setDragActive(false)
    const files = Array.from(event.dataTransfer.files || [])
    if (files.length) {
      updateFiles(files)
    }
  }

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length) {
      updateFiles(files)
    }
  }

  const stripArchiveExtension = (filename) => {
    const lower = filename.toLowerCase()
    if (lower.endsWith('.tar.gz')) return filename.slice(0, -7)
    if (lower.endsWith('.tgz')) return filename.slice(0, -4)
    if (lower.endsWith('.tar')) return filename.slice(0, -4)
    if (lower.endsWith('.zip')) return filename.slice(0, -4)
    if (lower.endsWith('.rar')) return filename.slice(0, -4)
    if (lower.endsWith('.7z')) return filename.slice(0, -3)
    if (lower.endsWith('.gz')) return filename.slice(0, -3)
    return filename.replace(/\.[^/.]+$/, '')
  }

  const buildFallbackName = () => {
    if (isCreate) {
      const base = selectedFiles.length === 1
        ? stripArchiveExtension(selectedFiles[0].name)
        : 'archive'
      const extension = format === 'tar.gz' ? '.tar.gz' : `.${format}`
      return base + extension
    }

    const base = selectedFiles.length ? stripArchiveExtension(selectedFiles[0].name) : 'archive'
    return `${base}_extracted.zip`
  }

  const downloadResponse = async (response) => {
    const fallbackName = buildFallbackName()
    const disposition = response.headers.get('content-disposition') || ''
    const match = disposition.match(/filename="?([^";]+)"?/i)
    const filename = match ? match[1] : fallbackName

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

  const handleProcess = async (event) => {
    event.preventDefault()
    if (!selectedFiles.length) {
      setErrorMessage('Please select a file first.')
      return
    }

    setIsProcessing(true)
    setErrorMessage('')

    const formData = new FormData()
    if (isCreate) {
      selectedFiles.forEach((file) => formData.append('files', file))
      formData.append('format', format)
    } else {
      formData.append('file', selectedFiles[0])
    }

    try {
      const response = await fetch(tool.apiEndpoint, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || response.statusText)
      }

      await downloadResponse(response)
      setSelectedFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setErrorMessage(err.message || 'Archive processing failed.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-10 text-left backdrop-blur">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>
      <h2 className="text-2xl font-semibold text-slate-50">{tool.title}</h2>
      <p className="mt-2 text-sm text-slate-400">Processed securely by the local Go backend running on your machine.</p>

      {errorMessage && <div className="mt-5 rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{errorMessage}</div>}

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleProcess}>
        <label
          className={dropZoneClass}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div className="text-sm text-slate-200">
            {selectedFiles.length
              ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} ready`
              : `Drag and drop ${isCreate ? 'files' : 'an archive'} here`}
          </div>
          <div className="mt-2 text-xs text-slate-400">or click to choose {isCreate ? 'files' : 'a file'}</div>
          <input
            type="file"
            accept={isCreate ? '*' : ARCHIVE_ACCEPT}
            multiple={isCreate}
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {selectedFiles.map((file) => (
              <span key={`${file.name}-${file.size}`} className="rounded-full border border-white/20 bg-slate-900/60 px-3 py-1 text-xs text-slate-200">
                {file.name}
              </span>
            ))}
          </div>
        )}

        {isCreate && (
          <div className="grid gap-4">
            <div className="flex flex-col gap-2 text-left">
              <label htmlFor="archive-format" className="text-xs uppercase tracking-[0.12em] text-slate-400">Archive format</label>
              <select
                id="archive-format"
                value={format}
                onChange={(event) => setFormat(event.target.value)}
                disabled={isProcessing}
                className="w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white"
              >
                {ARCHIVE_FORMATS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <div className="text-xs text-slate-400">RAR and 7Z require 7-Zip installed on your system.</div>
            </div>
          </div>
        )}

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !selectedFiles.length}
        >
          {isProcessing ? 'Processing...' : isCreate ? 'Create Archive' : 'Extract Archive'}
        </button>
      </form>
    </div>
  )
}

export default ArchiveToolView
