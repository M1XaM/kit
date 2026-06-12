import { useRef, useState } from 'react'

// Metadata Editor: upload a file, see the metadata actually embedded in it,
// edit the editable fields and download the file with the changes written in.
// PDF and MP3 fields are editable; images expose "strip all metadata".

type MetadataField = {
  key: string
  value: string
  editable: boolean
}

type MetadataInfo = {
  kind: string
  writable: boolean
  note?: string
  fields: MetadataField[]
}

const INPUT_CLASS = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white placeholder:text-slate-500'
const PRIMARY_BUTTON = 'rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
const SECONDARY_BUTTON = 'rounded-lg border px-4 py-2 text-sm font-semibold transition border-slate-400/40 bg-slate-400/15 text-slate-200 hover:bg-slate-400/25 disabled:cursor-not-allowed disabled:text-slate-500'

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function MetadataEditor() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [info, setInfo] = useState<MetadataInfo | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [dragActive, setDragActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const dropZoneClass = `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition text-slate-400 ${dragActive ? 'border-blue-400/70 bg-blue-600/20 text-slate-200' : 'border-white/20 hover:border-white/30 hover:bg-white/5'}`

  const loadFile = async (next: File | undefined) => {
    if (!next) return
    setFile(next)
    setInfo(null)
    setEdits({})
    setErrorMessage('')
    setIsLoading(true)
    try {
      const data = new FormData()
      data.append('file', next)
      const res = await fetch('/api/metadata/read', { method: 'POST', body: data })
      if (!res.ok) throw new Error((await res.text()) || res.statusText)
      setInfo(await res.json())
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not read the file metadata.')
    } finally {
      setIsLoading(false)
    }
  }

  const dirty = Object.keys(edits).length > 0

  const applyEdits = async (action: 'set' | 'strip') => {
    if (!file) return
    setIsApplying(true)
    setErrorMessage('')
    try {
      const data = new FormData()
      data.append('file', file)
      data.append('action', action)
      if (action === 'set') data.append('fields', JSON.stringify(edits))
      const res = await fetch('/api/metadata/apply', { method: 'POST', body: data })
      if (!res.ok) throw new Error((await res.text()) || res.statusText)
      const blob = await res.blob()
      downloadBlob(blob, file.name)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not apply the changes.')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="grid gap-6">
      <label
        className={dropZoneClass}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); loadFile(e.dataTransfer.files?.[0]) }}
      >
        <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <div className="text-sm text-slate-200">{file ? file.name : 'Drop a PDF, image or audio file here'}</div>
        <div className="mt-2 text-xs text-slate-400">or click to choose a file</div>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = '' }} />
      </label>

      {errorMessage && (
        <div className="rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      {isLoading && <div className="text-sm text-slate-400">Reading metadata…</div>}

      {info && (
        <>
          {info.note && <div className="text-xs text-slate-400">{info.note}</div>}

          <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
            {info.fields.map((field, index) => {
              const current = edits[field.key] ?? field.value
              return (
                <div
                  key={`${field.key}-${index}`}
                  className="grid grid-cols-[minmax(120px,200px)_1fr] items-center gap-3 border-b px-4 py-2 border-white/5 last:border-b-0"
                >
                  <span className="truncate text-xs uppercase tracking-[0.08em] text-slate-400">{field.key}</span>
                  {field.editable ? (
                    <input
                      className={INPUT_CLASS}
                      value={current}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder="empty"
                    />
                  ) : (
                    <span className="break-words py-1.5 text-sm text-slate-200">{field.value || <span className="text-slate-500">empty</span>}</span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {info.kind === 'image' ? (
              <button className={PRIMARY_BUTTON} type="button" disabled={isApplying || !info.writable} onClick={() => applyEdits('strip')}>
                {isApplying ? 'Working…' : 'Strip all metadata & download'}
              </button>
            ) : (
              <button className={PRIMARY_BUTTON} type="button" disabled={isApplying || !info.writable || !dirty} onClick={() => applyEdits('set')}>
                {isApplying ? 'Working…' : 'Apply changes & download'}
              </button>
            )}
            {dirty && (
              <button className={SECONDARY_BUTTON} type="button" onClick={() => setEdits({})}>
                Reset edits
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default MetadataEditor
