import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

// The PDF.js worker is bundled with Kit, so extraction works fully offline.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type PdfExtractTextViewProps = {
  tool: Tool
}

const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

const LABEL_CLASS = 'text-xs uppercase tracking-[0.12em] text-slate-400'
const PRIMARY_BUTTON = 'rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
const SUBTLE_BUTTON = 'rounded-lg border px-4 py-2 text-sm font-semibold transition border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500'

// pageText flattens one page's text items into readable lines.
const pageText = (content: { items: Array<{ str?: string; hasEOL?: boolean }> }) => {
  let text = ''
  for (const item of content.items) {
    if (typeof item.str === 'string') text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text.trim()
}

function PdfExtractTextView({ tool }: PdfExtractTextViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [resultText, setResultText] = useState('')
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

  const pickFile = (files: FileList | null) => {
    const next = files?.[0]
    if (!next) return
    setFile(next)
    setResultText('')
    setErrorMessage('')
  }

  const extractText = async () => {
    if (!file || isProcessing) return
    setIsProcessing(true)
    setErrorMessage('')
    setResultText('')
    setProgress({ done: 0, total: 0 })

    try {
      const data = await file.arrayBuffer()
      const doc = await pdfjsLib.getDocument({ data }).promise
      setProgress({ done: 0, total: doc.numPages })

      const pages: string[] = []
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i)
        const content = await page.getTextContent()
        pages.push(pageText(content))
        page.cleanup()
        setProgress({ done: i, total: doc.numPages })
      }
      await doc.destroy()

      const text = pages.join('\n\n').trim()
      setResultText(text)
      if (!text) {
        setErrorMessage('No selectable text was found. This PDF is probably a scan — try the OCR tool instead.')
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read the PDF.')
    } finally {
      setIsProcessing(false)
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
    const base = file ? stripExtension(file.name) : 'pdf'
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
        subtitle="Pull the text layer out of a PDF right in your browser — nothing is uploaded."
      />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <div className="mt-6 grid gap-5">
        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); pickFile(e.dataTransfer.files) }}
        >
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
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

        <div className="flex flex-wrap items-center gap-3">
          <button className={PRIMARY_BUTTON} type="button" onClick={extractText} disabled={isProcessing || !file}>
            {isProcessing
              ? progress.total
                ? `Extracting page ${progress.done}/${progress.total}...`
                : 'Opening PDF...'
              : 'Extract Text'}
          </button>
        </div>

        {resultText && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className={LABEL_CLASS}>Extracted text — {progress.total} page{progress.total === 1 ? '' : 's'}</label>
              <div className="flex gap-2">
                <button className={SUBTLE_BUTTON} type="button" onClick={copyResult}>Copy</button>
                <button className={SUBTLE_BUTTON} type="button" onClick={downloadResult}>Download .txt</button>
              </div>
            </div>
            <textarea
              className="min-h-[260px] w-full rounded-lg border px-3 py-2 font-mono text-sm border-slate-800 bg-slate-900/70 text-white"
              value={resultText}
              readOnly
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default PdfExtractTextView
