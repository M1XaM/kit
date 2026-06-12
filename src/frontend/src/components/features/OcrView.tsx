import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createWorker } from 'tesseract.js'
import FeatureHeader from './FeatureHeader'
import ModelPicker from './ModelPicker'
import type { Tool } from './toolData'

type OcrViewProps = {
  tool: Tool
}

type OcrModel = {
  id: string
  name: string
  sizeBytes: number
  bundled?: boolean
  downloaded: boolean
  downloading?: boolean
  progress?: number
  error?: string
}

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

const LABEL_CLASS = 'text-xs uppercase tracking-[0.12em] text-slate-400'
const PRIMARY_BUTTON = 'rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
const SUBTLE_BUTTON = 'rounded-lg border px-4 py-2 text-sm font-semibold transition border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500'

const MODELS_POLL_MS = 1500

// Everything Tesseract needs (worker, WASM core) is served by Kit itself — see
// the tesseract assets plugin in vite.config.js. The English language pack is
// bundled the same way; other languages are downloaded by the backend into
// data/ocr-models/ and served from /api/ocr/lang/.
const TESSERACT_BASE = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/tesseract-core-simd-lstm.wasm.js',
  gzip: true
}

function OcrView({ tool }: OcrViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState('')
  const [resultText, setResultText] = useState('')
  const [confidence, setConfidence] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const [models, setModels] = useState<OcrModel[]>([])
  const [language, setLanguage] = useState('eng')

  // Language registry + download state, polled so progress stays live (same
  // pattern as the other AI tools).
  useEffect(() => {
    let mounted = true
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/ocr/models', { cache: 'no-store' })
        if (!res.ok) throw new Error(await res.text())
        const json = await res.json()
        if (mounted) setModels(Array.isArray(json.models) ? json.models : [])
      } catch { /* keep last known state */ }
    }
    fetchModels()
    const timer = setInterval(fetchModels, MODELS_POLL_MS)
    return () => { mounted = false; clearInterval(timer) }
  }, [])

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
    setResultText('')
    setConfidence(null)
    setErrorMessage('')
  }

  const postId = async (path: string, id: string) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    if (!res.ok && res.status !== 202) throw new Error(await res.text())
  }

  const handleDownload = async (id: string) => {
    try { await postId('/api/ocr/models/download', id) }
    catch (err) { setErrorMessage(err instanceof Error ? err.message : 'Download failed to start') }
  }
  const handleDelete = async (id: string) => {
    try {
      await postId('/api/ocr/models/delete', id)
      if (language === id) setLanguage('eng')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not delete the language pack')
    }
  }

  const selectedModel = models.find((m) => m.id === language)
  const canRun = !!file && !isProcessing && !!selectedModel?.downloaded

  const runOcr = async () => {
    if (!canRun || !file) return
    setIsProcessing(true)
    setErrorMessage('')
    setResultText('')
    setConfidence(null)
    setProgress(0)
    setStatusText('Loading the OCR engine...')

    let worker = null
    try {
      // The bundled English pack lives in the app bundle; every other
      // language is served from the backend's data/ocr-models/ folder.
      const langPath = language === 'eng' ? '/tesseract/lang' : '/api/ocr/lang'
      worker = await createWorker(language, 1, {
        ...TESSERACT_BASE,
        langPath,
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setStatusText('Recognizing text...')
            setProgress(Math.round((m.progress || 0) * 100))
          }
        }
      })
      const { data } = await worker.recognize(file)
      setResultText(data.text || '')
      setConfidence(typeof data.confidence === 'number' ? Math.round(data.confidence) : null)
      if (!data.text?.trim()) {
        setErrorMessage('No text was found in this image. Try a sharper or higher-contrast scan, or a different language model.')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Text recognition failed.')
    } finally {
      if (worker) await worker.terminate().catch(() => {})
      setIsProcessing(false)
      setStatusText('')
      setProgress(0)
    }
  }

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(resultText)
    } catch {
      setErrorMessage('Unable to copy the text to the clipboard.')
    }
  }

  const downloadResult = () => {
    const base = file ? stripExtension(file.name) : 'ocr'
    const blob = new Blob([resultText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${base}_text.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-4xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader
        tool={tool}
        subtitle="Tesseract OCR runs entirely on your device. English ships with Kit; download more language models below."
      />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <div className="mt-6 grid gap-5">
        {/* Language model picker — same card UI as the other AI tools. */}
        <div>
          <label className={`${LABEL_CLASS} mb-1.5 block`}>Language model</label>
          <ModelPicker
            models={models.map((m) => ({
              id: m.id,
              name: m.name,
              sizeBytes: m.sizeBytes,
              downloaded: !!m.downloaded,
              downloading: !!m.downloading,
              progress: m.progress,
              error: m.error,
              recommended: m.bundled
            }))}
            selectedId={language}
            busy={isProcessing}
            onSelect={setLanguage}
            onDownload={handleDownload}
            onDelete={handleDelete}
            deletableIds={new Set(models.filter((m) => !m.bundled).map((m) => m.id))}
          />
        </div>

        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); pickFile(e.dataTransfer.files) }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt="Selected preview" className="mb-3 max-h-56 rounded-lg object-contain" />
          ) : (
            <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          )}
          <div className="text-sm text-slate-200">{file ? file.name : 'Drag and drop an image or scan here'}</div>
          <div className="mt-2 text-xs text-slate-400">or click to choose an image (PNG, JPG, BMP, ...)</div>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            disabled={isProcessing}
            onChange={(e) => pickFile(e.target.files)}
            className="hidden"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button className={PRIMARY_BUTTON} type="button" onClick={runOcr} disabled={!canRun}>
            {isProcessing
              ? 'Recognizing...'
              : selectedModel && !selectedModel.downloaded
                ? 'Download the language model first'
                : 'Extract Text'}
          </button>
        </div>

        {isProcessing && (
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>{statusText}</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {resultText && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className={LABEL_CLASS}>
                Recognized text{confidence != null ? ` — confidence ${confidence}%` : ''}
              </label>
              <div className="flex gap-2">
                <button className={SUBTLE_BUTTON} type="button" onClick={copyResult}>Copy</button>
                <button className={SUBTLE_BUTTON} type="button" onClick={downloadResult}>Download .txt</button>
              </div>
            </div>
            <textarea
              className="min-h-[220px] w-full rounded-lg border px-3 py-2 font-mono text-sm border-slate-800 bg-slate-900/70 text-white"
              value={resultText}
              readOnly
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default OcrView
