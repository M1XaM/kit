import { useRef, useState } from 'react'

// FileReorderList renders selected files as a vertical list whose order can be
// changed by dragging rows or with the arrow buttons. Used wherever the order
// of inputs matters (Merge PDF, File Converter).

type FileReorderListProps = {
  files: File[]
  disabled?: boolean
  onReorder: (next: File[]) => void
  onRemove: (index: number) => void
}

const formatBytes = (value: number) => {
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

function FileReorderList({ files, disabled, onReorder, onRemove }: FileReorderListProps) {
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= files.length || from === to) return
    const next = [...files]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onReorder(next)
  }

  if (!files.length) return null

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/60">
      {files.map((file, index) => (
        <div
          key={`${file.name}-${index}`}
          draggable={!disabled}
          onDragStart={() => { dragIndexRef.current = index }}
          onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index) }}
          onDragLeave={() => setDragOverIndex((prev) => (prev === index ? null : prev))}
          onDrop={(e) => {
            e.preventDefault()
            setDragOverIndex(null)
            if (dragIndexRef.current != null) move(dragIndexRef.current, index)
            dragIndexRef.current = null
          }}
          onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null) }}
          className={`flex items-center gap-3 border-b px-3 py-2 text-sm border-white/5 last:border-b-0 ${
            dragOverIndex === index ? 'bg-blue-600/20' : ''
          } ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
        >
          <span className="select-none text-slate-500" aria-hidden="true">⠿</span>
          <span className="w-6 shrink-0 text-xs text-slate-500">{index + 1}.</span>
          <span className="min-w-0 flex-1 truncate text-slate-200">{file.name}</span>
          <span className="shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${file.name} up`}
              className="rounded border px-1.5 py-0.5 text-xs border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/15 disabled:opacity-40"
              onClick={() => move(index, index - 1)}
              disabled={disabled || index === 0}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${file.name} down`}
              className="rounded border px-1.5 py-0.5 text-xs border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/15 disabled:opacity-40"
              onClick={() => move(index, index + 1)}
              disabled={disabled || index === files.length - 1}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              className="ml-1 rounded border px-1.5 py-0.5 text-xs border-white/10 bg-white/5 text-slate-400 transition hover:text-red-300 disabled:opacity-40"
              onClick={() => onRemove(index)}
              disabled={disabled}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

export default FileReorderList
