import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import FileReorderList from './FileReorderList'
import type { Tool } from './toolData'

type FieldType = 'text' | 'select' | 'password'

type FieldConfig = {
  name: string
  type: FieldType
  label: string
  placeholder?: string
  required?: boolean
  default?: string
  options?: { value: string; label: string }[]
}

type PdfToolConfig = {
  input: 'single' | 'multi'
  endpoint: string
  downloadExt: string
  action: string
  hint?: string
  minFiles?: number
  fields: FieldConfig[]
}

// Declarative config for the form-based Documents tools. Each entry drives the
// generic PdfToolView below; the backend handlers live under /api/pdf/*.
const PDF_TOOL_CONFIG: Record<string, PdfToolConfig> = {
  'merge-pdf': {
    input: 'multi',
    endpoint: '/api/pdf/merge',
    downloadExt: 'pdf',
    action: 'Merge PDFs',
    hint: 'PDFs are combined in the order listed below.',
    minFiles: 2,
    fields: []
  },
  'extract-pages': {
    input: 'single',
    endpoint: '/api/pdf/extract-pages',
    downloadExt: 'pdf',
    action: 'Extract Pages',
    fields: [{ name: 'pages', type: 'text', label: 'Pages to keep', placeholder: 'e.g. 1-3,5', required: true }]
  },
  'delete-pages': {
    input: 'single',
    endpoint: '/api/pdf/delete-pages',
    downloadExt: 'pdf',
    action: 'Delete Pages',
    fields: [{ name: 'pages', type: 'text', label: 'Pages to delete', placeholder: 'e.g. 2,4-6', required: true }]
  },
  'reorder-pages': {
    input: 'single',
    endpoint: '/api/pdf/reorder-pages',
    downloadExt: 'pdf',
    action: 'Reorder Pages',
    hint: 'List every page in the order you want them to appear.',
    fields: [{ name: 'order', type: 'text', label: 'New page order', placeholder: 'e.g. 3,1,2', required: true }]
  },
  'rotate-pages': {
    input: 'single',
    endpoint: '/api/pdf/rotate',
    downloadExt: 'pdf',
    action: 'Rotate PDF',
    fields: [
      {
        name: 'rotation',
        type: 'select',
        label: 'Rotation',
        default: '90',
        options: [
          { value: '90', label: '90° clockwise' },
          { value: '180', label: '180°' },
          { value: '270', label: '270° clockwise' }
        ]
      },
      { name: 'pages', type: 'text', label: 'Pages to rotate (optional)', placeholder: 'blank = all pages' }
    ]
  },
  'encrypt-decrypt-pdf': {
    input: 'single',
    endpoint: '/api/pdf/protect',
    downloadExt: 'pdf',
    action: 'Apply',
    fields: [
      {
        name: 'mode',
        type: 'select',
        label: 'Mode',
        default: 'encrypt',
        options: [
          { value: 'encrypt', label: 'Encrypt (add password)' },
          { value: 'decrypt', label: 'Decrypt (remove password)' }
        ]
      },
      { name: 'password', type: 'password', label: 'Password', placeholder: 'Enter password', required: true }
    ]
  }
}

const INPUT_CLASS = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white placeholder:text-slate-500'
const LABEL_CLASS = 'text-xs uppercase tracking-[0.12em] text-slate-400'

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

type PdfToolViewProps = {
  tool: Tool
}

function PdfToolView({ tool }: PdfToolViewProps) {
  const config = PDF_TOOL_CONFIG[tool.id]
  const isMulti = config.input === 'multi'
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    config.fields.forEach((field) => {
      initial[field.name] = field.default ?? (field.type === 'select' ? field.options?.[0]?.value ?? '' : '')
    })
    return initial
  })
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

  // Multi-file tools (Merge PDF) append so the user can add more PDFs and
  // rearrange them; single-file tools replace.
  const updateFiles = (files: File[]) => {
    if (!files.length) return
    setSelectedFiles((prev) => (isMulti ? [...prev, ...files] : files.slice(0, 1)))
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
    // Reset so picking the same file again still fires onChange.
    event.target.value = ''
  }

  const setField = (name: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [name]: value }))
  }

  const downloadResponse = async (response: Response) => {
    const base = selectedFiles.length ? stripExtension(selectedFiles[0].name) : 'document'
    let filename = `${base}_${tool.id}.${config.downloadExt}`
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

    const minFiles = config.minFiles ?? 1
    if (selectedFiles.length < minFiles) {
      setErrorMessage(minFiles > 1 ? `Select at least ${minFiles} files.` : 'Please select a file first.')
      return
    }

    for (const field of config.fields) {
      if (field.required && !fieldValues[field.name]?.trim()) {
        setErrorMessage(`${field.label} is required.`)
        return
      }
    }

    setIsProcessing(true)
    setErrorMessage('')

    const formData = new FormData()
    if (isMulti) {
      selectedFiles.forEach((file) => formData.append('files', file))
    } else {
      formData.append('file', selectedFiles[0])
    }
    config.fields.forEach((field) => {
      const value = fieldValues[field.name]
      if (value != null && value !== '') formData.append(field.name, value)
    })

    try {
      const response = await fetch(config.endpoint, { method: 'POST', body: formData })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || response.statusText)
      }
      await downloadResponse(response)
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

      <FeatureHeader tool={tool} subtitle="Processed locally by the Go backend on your machine." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <form className="mt-8 flex flex-col gap-5" onSubmit={handleSubmit}>
        <label className={dropZoneClass} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
          <div className="text-sm text-slate-200">
            {selectedFiles.length
              ? isMulti
                ? `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected`
                : selectedFiles[0].name
              : `Drag and drop ${isMulti ? 'PDF files' : 'a PDF'} here`}
          </div>
          <div className="mt-2 text-xs text-slate-400">or click to choose {isMulti ? 'files' : 'a file'}</div>
          <input
            type="file"
            accept="application/pdf"
            multiple={isMulti}
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {isMulti && selectedFiles.length > 0 && (
          <div className="flex flex-col gap-2">
            <FileReorderList
              files={selectedFiles}
              disabled={isProcessing}
              onReorder={setSelectedFiles}
              onRemove={(index) => setSelectedFiles((prev) => prev.filter((_, i) => i !== index))}
            />
            <p className="text-xs text-slate-500">Drag rows (or use the arrows) to set the merge order. Drop more PDFs above to add them.</p>
          </div>
        )}

        {config.fields.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {config.fields.map((field) => (
              <div key={field.name} className="flex flex-col gap-2">
                <label htmlFor={`pdf-field-${field.name}`} className={LABEL_CLASS}>{field.label}</label>
                {field.type === 'select' ? (
                  <select
                    id={`pdf-field-${field.name}`}
                    className={INPUT_CLASS}
                    value={fieldValues[field.name] ?? ''}
                    onChange={(event) => setField(field.name, event.target.value)}
                    disabled={isProcessing}
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`pdf-field-${field.name}`}
                    type={field.type === 'password' ? 'password' : 'text'}
                    className={INPUT_CLASS}
                    value={fieldValues[field.name] ?? ''}
                    onChange={(event) => setField(field.name, event.target.value)}
                    placeholder={field.placeholder}
                    disabled={isProcessing}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {config.hint && <div className="text-xs text-slate-400">{config.hint}</div>}

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !selectedFiles.length}
        >
          {isProcessing ? 'Processing...' : config.action}
        </button>
      </form>
    </div>
  )
}

export default PdfToolView
