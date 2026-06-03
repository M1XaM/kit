import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type MergeVideoViewProps = {
  tool: Tool
}

type Clip = {
  id: string
  file: File
  url: string
  name: string
  size: number
}

const formatBytes = (value: number) => {
  if (value == null || Number.isNaN(value)) return '--'
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

const buildId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const moveBtnClass =
  'rounded-md border px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'

function MergeVideoView({ tool }: MergeVideoViewProps) {
  const [clips, setClips] = useState<Clip[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const clipsRef = useRef<Clip[]>([])
  useEffect(() => { clipsRef.current = clips }, [clips])
  useEffect(() => () => { clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url)) }, [])

  const addFiles = (files: FileList | null) => {
    const incoming = Array.from(files || []).filter((f) => f.type.startsWith('video/') || /\.(mp4|webm|mkv|mov|avi|m4v|ogv)$/i.test(f.name))
    if (!incoming.length) return
    setErrorMessage('')
    const next: Clip[] = incoming.map((file) => ({
      id: buildId(),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      size: file.size
    }))
    setClips((prev) => [...prev, ...next])
  }

  const removeClip = (id: string) => {
    setClips((prev) => {
      const target = prev.find((c) => c.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((c) => c.id !== id)
    })
  }

  const moveClip = (index: number, direction: -1 | 1) => {
    setClips((prev) => {
      const next = index + direction
      if (next < 0 || next >= prev.length) return prev
      const copy = [...prev]
      ;[copy[index], copy[next]] = [copy[next], copy[index]]
      return copy
    })
  }

  const dropZoneClass = useMemo(
    () =>
      `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition text-slate-400 ${
        dragActive
          ? 'border-blue-400/70 bg-blue-600/20 text-slate-200'
          : 'border-white/20 hover:border-white/30 hover:bg-white/5'
      }`,
    [dragActive]
  )

  const merge = async () => {
    if (clips.length < 2) {
      setErrorMessage('Add at least two video clips to merge.')
      return
    }

    setIsProcessing(true)
    setErrorMessage('')
    try {
      const data = new FormData()
      clips.forEach((clip) => data.append('file', clip.file))

      const response = await fetch(tool.apiEndpoint as string, { method: 'POST', body: data })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || response.statusText)
      }

      const disposition = response.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      const filename = match ? match[1] : 'merged.mp4'

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
      setErrorMessage(err instanceof Error ? err.message : 'Failed to merge the clips.')
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

      <FeatureHeader tool={tool} subtitle="Reorder and combine multiple clips into one video — processed locally by the Go backend using ffmpeg." />

      <p className="mt-3 text-xs text-slate-500">Clips are normalized to a common size and frame rate (matching the first clip), then joined. Output is MP4.</p>

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <div className="mt-6 flex flex-col gap-5">
        <label
          className={dropZoneClass}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false) }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); addFiles(e.dataTransfer.files) }}
        >
          <svg className="mb-2" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          </svg>
          <div className="text-sm text-slate-200">Drag and drop video clips here</div>
          <div className="mt-1 text-xs text-slate-400">or click to add — MP4, WebM, MKV, MOV…</div>
          <input type="file" accept="video/*" multiple disabled={isProcessing} onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} className="hidden" />
        </label>

        {clips.length > 0 && (
          <div className="flex flex-col gap-3">
            {clips.map((clip, index) => (
              <div key={clip.id} className="rounded-xl border p-3 border-white/10 bg-slate-950/50">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <button type="button" className={moveBtnClass} onClick={() => moveClip(index, -1)} disabled={isProcessing || index === 0} aria-label="Move up">▲</button>
                    <button type="button" className={moveBtnClass} onClick={() => moveClip(index, 1)} disabled={isProcessing || index === clips.length - 1} aria-label="Move down">▼</button>
                  </div>
                  <video className="h-16 rounded-lg bg-black" src={clip.url} preload="metadata" muted />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-100" title={clip.name}>
                      <span className="mr-1 text-slate-400">{index + 1}.</span>{clip.name}
                    </div>
                    <div className="text-xs text-slate-400">{formatBytes(clip.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeClip(clip.id)}
                    disabled={isProcessing}
                    className="rounded-md border px-2 py-1 text-xs font-semibold transition border-white/15 bg-white/5 text-slate-300 hover:bg-white/10"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={merge}
          disabled={isProcessing || clips.length < 2}
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isProcessing ? 'Merging…' : `Merge ${clips.length || ''} clip${clips.length === 1 ? '' : 's'} → MP4`}
        </button>

        {clips.length === 1 && (
          <p className="text-center text-xs text-slate-400">Add at least two clips to enable merging.</p>
        )}
      </div>
    </div>
  )
}

export default MergeVideoView
