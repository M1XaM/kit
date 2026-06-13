import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  addRecentFile,
  clearRecentFiles,
  deleteRecentFile,
  getRecentFile,
  listRecentFiles,
  subscribeRecentFiles,
  type RecentFileMeta,
} from '../../state/recentFiles'

// DataTransfer type used to mark a drag that originates from this panel, so the
// global drop handler can tell "user dragged a recent file into a feature"
// apart from "user dragged a file in from their OS".
const RECENT_DRAG_TYPE = 'application/x-kit-recent'

// The recent file currently being dragged from the panel. We stash it on
// dragstart because the dataTransfer payload can't be read during dragover (only
// on drop) — yet dragover is exactly when we need the file's type to judge
// whether it fits the tool under the cursor.
let draggingRecent: { name: string; type: string } | null = null

// A live hint painted over a feature's drop zone while a recent file is dragged
// over it: blue when the file fits, red (with a reason) when it doesn't.
type DropHint = { rect: DOMRect; ok: boolean; message: string }

// extOf returns a file's lowercased extension including the dot (".pdf"), or ''.
function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i)
  return m ? `.${m[1].toLowerCase()}` : ''
}

// fileMatchesAccept reports whether a file satisfies an <input accept="…">
// list, mirroring how the browser itself interprets it: comma-separated
// extensions (".png"), wildcards ("image/*") or exact MIME types.
function fileMatchesAccept(file: { name: string; type: string }, accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (tokens.length === 0 || tokens.includes('*') || tokens.includes('*/*')) return true

  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  const hasExtToken = tokens.some((t) => t.startsWith('.'))

  for (const tok of tokens) {
    if (tok.startsWith('.')) {
      if (name.endsWith(tok)) return true
    } else if (tok.endsWith('/*')) {
      if (type && type.startsWith(tok.slice(0, -1))) return true
    } else if (type && type === tok) {
      return true
    }
  }
  // If the browser gave us no MIME type and the rules were all MIME-based, we
  // can't prove a mismatch — allow it rather than wrongly block a fine file.
  if (!type && !hasExtToken) return true
  return false
}

// dropZoneOf finds the visual drop area around a file input (the dashed label
// or form) so the hint outlines the whole zone, not the hidden input.
function dropZoneOf(input: HTMLInputElement): HTMLElement {
  return (input.closest('label, form, [data-recent-drop]') as HTMLElement) ?? input
}

// ---------------------------------------------------------------------------
// Global capture: record every file the user loads into any feature.
// ---------------------------------------------------------------------------
// Rather than wiring each of the ~30 feature views, we listen once at the
// document level. `change` covers file pickers; `drop` covers files dragged in
// from the OS. Both fire in the capture phase so we see them before the view's
// own handler, and neither prevents the view from doing its normal thing.

function featureFromPath(): string {
  const m = window.location.pathname.match(/\/tool\/([^/]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

function recordFiles(files: FileList | File[] | null | undefined) {
  if (!files) return
  const feature = featureFromPath()
  for (const file of Array.from(files)) {
    if (file instanceof File) addRecentFile(file, feature)
  }
}

function useRecentFilesCapture() {
  useEffect(() => {
    const onChange = (e: Event) => {
      const target = e.target as HTMLInputElement | null
      if (target && target.tagName === 'INPUT' && target.type === 'file') {
        recordFiles(target.files)
      }
    }
    const onDrop = (e: DragEvent) => {
      // Our own panel-originated drags carry no OS files (we inject them
      // separately), so skip them here to avoid a no-op round trip.
      if (e.dataTransfer?.types.includes(RECENT_DRAG_TYPE)) return
      recordFiles(e.dataTransfer?.files)
    }
    document.addEventListener('change', onChange, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('change', onChange, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [])
}

// ---------------------------------------------------------------------------
// Global injection: dropping a recent file onto a feature feeds it the file.
// ---------------------------------------------------------------------------
// HTML5 drag&drop can't put a reconstructed File into the drop event's
// read-only dataTransfer, so instead we find the file <input> nearest the drop
// point, assign its `.files` via a synthetic DataTransfer, and dispatch a
// `change` event — the same signal a real file pick produces, which every
// feature view already listens for.

function findFileInput(x: number, y: number): HTMLInputElement | null {
  const fileInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ).filter((el) => !el.disabled)
  if (fileInputs.length === 0) return null

  // Prefer an input inside the container under the cursor (the drop zone the
  // user aimed at); fall back to the only/first input on the page otherwise.
  const dropTarget = document.elementFromPoint(x, y)
  if (dropTarget) {
    const scope = dropTarget.closest('form, label, [data-recent-drop]') ?? dropTarget
    const scoped = scope.querySelector<HTMLInputElement>('input[type="file"]:not([disabled])')
    if (scoped) return scoped
    const sibling = fileInputs.find((el) => scope.contains(el) || el.contains(scope))
    if (sibling) return sibling
  }
  return fileInputs[0]
}

function injectFileIntoInput(input: HTMLInputElement, file: File) {
  const dt = new DataTransfer()
  dt.items.add(file)
  input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function useRecentFileInjection(onInject: () => void, onHint: (hint: DropHint | null) => void) {
  const onInjectRef = useRef(onInject)
  onInjectRef.current = onInject
  const onHintRef = useRef(onHint)
  onHintRef.current = onHint

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(RECENT_DRAG_TYPE)) return
      e.preventDefault()
      // While the pointer is still over the panel there's no drop zone to judge.
      const over = document.elementFromPoint(e.clientX, e.clientY)
      const input = over?.closest('[data-recent-panel]') ? null : findFileInput(e.clientX, e.clientY)
      if (!input || !draggingRecent) {
        e.dataTransfer.dropEffect = 'copy'
        onHintRef.current(null)
        return
      }
      const ok = fileMatchesAccept(draggingRecent, input.accept || '')
      // 'none' tells the OS this is an invalid target (no drop will fire).
      e.dataTransfer.dropEffect = ok ? 'copy' : 'none'
      const ext = extOf(draggingRecent.name)
      onHintRef.current({
        rect: dropZoneOf(input).getBoundingClientRect(),
        ok,
        message: ok ? '' : `${ext ? `${ext} files` : 'This file type'} aren’t supported by this tool`,
      })
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes(RECENT_DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      onHintRef.current(null)
      const id = e.dataTransfer.getData(RECENT_DRAG_TYPE)
      if (!id) return
      // Dropping back onto the panel is a no-op, not an injection.
      const over = document.elementFromPoint(e.clientX, e.clientY)
      if (over?.closest('[data-recent-panel]')) return
      const input = findFileInput(e.clientX, e.clientY)
      if (!input) return
      // Guard the drop too: some browsers still deliver it despite dropEffect.
      if (draggingRecent && !fileMatchesAccept(draggingRecent, input.accept || '')) return
      const file = getRecentFile(id)
      if (file) {
        injectFileIntoInput(input, file)
        onInjectRef.current()
      }
    }
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [])
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

function formatWhen(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function kindOf(type: string, name: string): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'archive' | 'other' {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|ya?ml)$/i.test(name)) return 'text'
  if (/\.(zip|tar|gz|tgz|7z|rar)$/i.test(name)) return 'archive'
  return 'other'
}

function FileIcon({ kind, big = false }: { kind: ReturnType<typeof kindOf>; big?: boolean }) {
  const glyph: Record<ReturnType<typeof kindOf>, string> = {
    image: '🖼️',
    video: '🎞️',
    audio: '🎵',
    pdf: '📄',
    text: '📝',
    archive: '🗜️',
    other: '📦',
  }
  return <span className={`leading-none ${big ? 'text-3xl' : 'text-xl'}`}>{glyph[kind]}</span>
}

// Thumb shows an actual thumbnail for images in the grid (read straight from
// the live File reference) and falls back to the type glyph for everything else.
function Thumb({ meta, kind }: { meta: RecentFileMeta; kind: ReturnType<typeof kindOf> }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (kind !== 'image') return
    const file = getRecentFile(meta.id)
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [meta.id, kind])

  if (kind === 'image' && url) {
    return <img src={url} alt={meta.name} className="h-full w-full object-cover" />
  }
  return <FileIcon kind={kind} big />
}

// ---------------------------------------------------------------------------
// Hover preview card
// ---------------------------------------------------------------------------
// Hovering a recent file pops a floating card next to it (to the left of the
// panel, near the cursor) showing the file big enough to actually read/inspect.
// The card itself is hoverable: documents and text scroll, and audio/video get
// native play controls. The parent keeps it open while the pointer is over
// either the row or the card.

type HoverPreviewProps = {
  meta: RecentFileMeta
  anchorRect: DOMRect
  onEnter: () => void
  onLeave: () => void
}

function HoverPreview({ meta, anchorRect, onEnter, onLeave }: HoverPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ right: number; top: number } | null>(null)
  const kind = kindOf(meta.type, meta.name)

  // Read from the live File reference for this preview. The bytes come straight
  // from the file on disk — nothing was copied to get here.
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    setUrl(null)
    setText(null)
    setError(false)

    const file = getRecentFile(meta.id)
    if (!file) {
      setError(true)
      return
    }
    if (kind === 'text') {
      // Cap how much we read so a huge log doesn't freeze the card.
      const slice = file.slice(0, 256 * 1024)
      slice.text().then((body) => {
        if (!cancelled) setText(file.size > slice.size ? `${body}\n\n… (truncated)` : body)
      })
      return () => {
        cancelled = true
      }
    }
    objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [meta.id, kind])

  // Position the card just to the left of the hovered row, clamped to the
  // viewport. Re-run when the measured content changes the card's height.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const gap = 12
    const height = card.offsetHeight
    const right = Math.max(8, window.innerWidth - anchorRect.left + gap)
    let top = anchorRect.top + anchorRect.height / 2 - height / 2
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8))
    setPos({ right, top })
  }, [anchorRect, kind, url, text, error])

  return (
    <div
      ref={cardRef}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        right: pos ? `${pos.right}px` : `${window.innerWidth - anchorRect.left + 12}px`,
        top: pos ? `${pos.top}px` : `${anchorRect.top}px`,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="fixed z-[60] flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-white/15 bg-slate-950/98 shadow-2xl backdrop-blur"
    >
      <div className="border-b border-white/10 px-3 py-2">
        <div className="truncate text-xs font-semibold text-slate-100">{meta.name}</div>
        <div className="text-[0.65rem] text-slate-500">
          {formatBytes(meta.size)} · {meta.type || 'unknown type'}
        </div>
      </div>

      <div className="flex items-center justify-center bg-black/30 p-2">
        {error && <div className="py-8 text-xs text-slate-400">Preview unavailable.</div>}

        {!error && kind === 'image' && url && (
          <img src={url} alt={meta.name} className="max-h-[60vh] max-w-full object-contain" />
        )}

        {!error && kind === 'video' && url && (
          // controls give the requested play button; preload metadata so the
          // poster frame shows without auto-downloading the whole clip.
          <video src={url} controls preload="metadata" className="max-h-[60vh] max-w-full" />
        )}

        {!error && kind === 'audio' && url && (
          <div className="w-full px-2 py-6">
            <audio src={url} controls preload="metadata" className="w-full" />
          </div>
        )}

        {!error && kind === 'pdf' && url && (
          // Scrollable inside its own viewport — the user can hover and scroll.
          <object data={url} type="application/pdf" className="h-[60vh] w-full">
            <p className="p-4 text-xs text-slate-400">PDF preview unavailable.</p>
          </object>
        )}

        {!error && kind === 'text' && text !== null && (
          <pre className="max-h-[60vh] w-full overflow-auto whitespace-pre-wrap break-words p-2 text-left text-xs leading-relaxed text-slate-300">
            {text}
          </pre>
        )}

        {!error && (kind === 'other' || kind === 'archive') && (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            <div className="mb-2 text-3xl">
              <FileIcon kind={kind} />
            </div>
            No inline preview for this file type.
          </div>
        )}

        {!error && url === null && text === null && kind !== 'other' && kind !== 'archive' && (
          <div className="py-8 text-xs text-slate-400">Loading…</div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drop-zone hint overlay
// ---------------------------------------------------------------------------
// Painted over the feature's drop area while a recent file is dragged over it.
// It never intercepts the drag (pointer-events-none); it just outlines the zone
// blue (fits) or red (doesn't, with a reason).

function DropHintOverlay({ hint }: { hint: DropHint | null }) {
  if (!hint) return null
  const { rect, ok, message } = hint
  return (
    <div
      className="pointer-events-none fixed z-50"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
    >
      <div
        className={`h-full w-full rounded-xl border-2 border-dashed transition-colors ${
          ok ? 'border-blue-400/70 bg-blue-500/5' : 'border-red-500/80 bg-red-500/10'
        }`}
      />
      {!ok && message && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-md bg-red-600/95 px-3 py-1 text-xs font-medium text-white shadow-lg">
          {message}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent file row / card
// ---------------------------------------------------------------------------

type RecentItemProps = {
  meta: RecentFileMeta
  viewMode: 'list' | 'grid'
  onDragStart: (e: React.DragEvent, meta: RecentFileMeta) => void
  onDragEnd: () => void
  onShow: (meta: RecentFileMeta, rect: DOMRect) => void
  onScheduleClose: () => void
  onDelete: (id: string) => void
}

function RecentItem({
  meta,
  viewMode,
  onDragStart,
  onDragEnd,
  onShow,
  onScheduleClose,
  onDelete,
}: RecentItemProps) {
  const kind = kindOf(meta.type, meta.name)

  const handleEnter = (e: React.MouseEvent) =>
    onShow(meta, (e.currentTarget as HTMLElement).getBoundingClientRect())
  const handleFocus = (e: React.FocusEvent) => {
    const host = (e.currentTarget as HTMLElement).closest('[data-recent-item]')
    if (host) onShow(meta, host.getBoundingClientRect())
  }

  const deleteButton = (className: string) => (
    <button
      type="button"
      onClick={() => onDelete(meta.id)}
      aria-label={`Remove ${meta.name}`}
      className={className}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  )

  if (viewMode === 'grid') {
    return (
      <div
        data-recent-item
        draggable
        onDragStart={(e) => onDragStart(e, meta)}
        onDragEnd={onDragEnd}
        onMouseEnter={handleEnter}
        onMouseLeave={onScheduleClose}
        className="group relative flex cursor-grab flex-col rounded-xl border border-white/10 bg-white/5 p-2 transition hover:border-white/20 hover:bg-white/10 active:cursor-grabbing"
        title="Hover to preview · drag onto a tool to reuse"
      >
        <button type="button" onFocus={handleFocus} onBlur={onScheduleClose} className="flex min-w-0 flex-col text-left">
          <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-slate-800/80">
            <Thumb meta={meta} kind={kind} />
          </span>
          <span className="mt-1.5 truncate text-[0.72rem] text-slate-200">{meta.name}</span>
          <span className="truncate text-[0.62rem] text-slate-500">{formatBytes(meta.size)}</span>
        </button>
        {deleteButton(
          'absolute right-1.5 top-1.5 rounded-md bg-slate-900/80 p-1 text-slate-300 opacity-0 transition hover:bg-slate-800 hover:text-red-300 group-hover:opacity-100',
        )}
      </div>
    )
  }

  return (
    <li
      data-recent-item
      draggable
      onDragStart={(e) => onDragStart(e, meta)}
      onDragEnd={onDragEnd}
      onMouseEnter={handleEnter}
      onMouseLeave={onScheduleClose}
      className="group flex cursor-grab items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5 transition hover:border-white/20 hover:bg-white/10 active:cursor-grabbing"
      title="Hover to preview · drag onto a tool to reuse"
    >
      <button
        type="button"
        onFocus={handleFocus}
        onBlur={onScheduleClose}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800/80">
          <FileIcon kind={kind} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-slate-200">{meta.name}</span>
          <span className="block text-[0.7rem] text-slate-500">
            {formatBytes(meta.size)} · {formatWhen(meta.addedAt)}
            {meta.feature ? ` · ${meta.feature}` : ''}
          </span>
        </span>
      </button>
      {deleteButton(
        'flex-shrink-0 rounded-md p-1 text-slate-500 opacity-0 transition hover:bg-white/10 hover:text-red-300 group-hover:opacity-100',
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function RecentFilesPanel() {
  const [open, setOpen] = useState(false)
  // Live red/blue outline shown over a feature's drop zone during a drag.
  const [dropHint, setDropHint] = useState<DropHint | null>(null)

  useRecentFilesCapture()
  // Once a recent file lands in a feature, close the panel so the user sees the
  // tool it dropped into instead of the still-open overlay.
  useRecentFileInjection(
    useCallback(() => setOpen(false), []),
    setDropHint,
  )

  const [files, setFiles] = useState<RecentFileMeta[]>([])
  // View mode is a list/grid toggle; grid (thumbnail cards) is the default.
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid')
  // The hover preview: which file and the screen rect of the row it anchors to.
  const [hovered, setHovered] = useState<{ meta: RecentFileMeta; rect: DOMRect } | null>(null)
  const dragImageRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    setFiles(listRecentFiles())
  }, [])

  useEffect(() => {
    refresh()
    return subscribeRecentFiles(refresh)
  }, [refresh])

  // The preview only makes sense while the panel is open.
  useEffect(() => {
    if (!open) setHovered(null)
  }, [open])

  // Close on Escape when the panel is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (hovered) setHovered(null)
        else setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, hovered])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  // Small grace period so moving the pointer from the row across the gap to the
  // card doesn't dismiss the preview.
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setHovered(null), 160)
  }, [cancelClose])

  const showPreview = useCallback(
    (meta: RecentFileMeta, rect: DOMRect) => {
      cancelClose()
      setHovered({ meta, rect })
    },
    [cancelClose],
  )

  const onDragStart = (e: React.DragEvent, meta: RecentFileMeta) => {
    e.dataTransfer.setData(RECENT_DRAG_TYPE, meta.id)
    e.dataTransfer.effectAllowed = 'copy'
    if (dragImageRef.current) {
      dragImageRef.current.textContent = meta.name
      e.dataTransfer.setDragImage(dragImageRef.current, 0, 0)
    }
    // Remember what's being dragged so the drop-zone hint can judge fit during
    // dragover (when the dataTransfer payload itself is unreadable).
    draggingRecent = { name: meta.name, type: meta.type }
    // Hide the preview while dragging so it doesn't obscure the drop target.
    cancelClose()
    setHovered(null)
  }

  const onDragEnd = () => {
    draggingRecent = null
    setDropHint(null)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Sliding panel, above the main screen, from the right. The edge tab is a
          child of the panel so it slides as one piece with it — same transform,
          same transition — instead of drifting ahead on its own timing. */}
      <aside
        data-recent-panel
        className={`fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-white/10 bg-slate-950/95 shadow-2xl backdrop-blur transition-transform duration-300 sm:w-[22rem] ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Edge tab — rides on the panel's left edge, protruding into the
            viewport so it stays reachable while the panel is off-screen. */}
        <button
          type="button"
          aria-label={open ? 'Close recent files' : 'Open recent files'}
          onClick={() => setOpen((v) => !v)}
          className="absolute left-0 top-1/2 flex -translate-x-full -translate-y-1/2 items-center gap-1 rounded-l-xl border border-r-0 border-white/15 bg-slate-900/90 py-3 pl-2 pr-1.5 text-slate-300 shadow-lg backdrop-blur transition-colors hover:bg-slate-800 hover:text-white"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          >
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <span className="text-[0.7rem] font-semibold uppercase tracking-wide [writing-mode:vertical-rl]">
            Recent
          </span>
        </button>

        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Recent files</div>
            <div className="text-[0.7rem] text-slate-500">Drag one onto a tool to reuse it</div>
          </div>
          {files.length > 0 && (
            <button
              type="button"
              onClick={() => clearRecentFiles()}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-400 transition hover:border-red-400/40 hover:text-red-300"
            >
              Clear
            </button>
          )}
        </div>

        {/* List / grid toggle. */}
        {files.length > 0 && (
          <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2">
            <span className="mr-auto text-[0.65rem] uppercase tracking-wide text-slate-500">View</span>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[0.7rem] transition ${
                viewMode === 'list'
                  ? 'border-blue-400/50 bg-blue-500/15 text-blue-200'
                  : 'border-white/10 text-slate-400 hover:bg-white/5'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[0.7rem] transition ${
                viewMode === 'grid'
                  ? 'border-blue-400/50 bg-blue-500/15 text-blue-200'
                  : 'border-white/10 text-slate-400 hover:bg-white/5'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              Grid
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {files.length === 0 ? (
            <div className="mt-10 px-4 text-center text-sm text-slate-500">
              <div className="mb-2 text-3xl">🗂️</div>
              No recent files yet. Open a tool and load a file — it'll show up here so
              you can preview it or drag it into another tool.
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 gap-2">
              {files.map((meta) => (
                <RecentItem
                  key={meta.id}
                  meta={meta}
                  viewMode="grid"
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onShow={showPreview}
                  onScheduleClose={scheduleClose}
                  onDelete={deleteRecentFile}
                />
              ))}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {files.map((meta) => (
                <RecentItem
                  key={meta.id}
                  meta={meta}
                  viewMode="list"
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onShow={showPreview}
                  onScheduleClose={scheduleClose}
                  onDelete={deleteRecentFile}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-white/10 px-4 py-2 text-[0.65rem] leading-relaxed text-slate-600">
          These are references to the originals on your machine — nothing is copied, stored or
          uploaded. The list resets when you reload.
        </div>
      </aside>

      {/* Off-screen node reused as a tidy drag image. */}
      <div
        ref={dragImageRef}
        className="pointer-events-none fixed -left-[999px] top-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
      />

      {hovered && (
        <HoverPreview
          meta={hovered.meta}
          anchorRect={hovered.rect}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}

      <DropHintOverlay hint={dropHint} />
    </>
  )
}

export default RecentFilesPanel
