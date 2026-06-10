import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import DOMPurify from 'dompurify'
import 'katex/dist/katex.min.css'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type NotesViewProps = {
  tool: Tool
}

type NoteMeta = {
  id: string
  name: string
  title: string
  preview: string
  modified: number
  size: number
}

const LOCKED_STORAGE_KEY = 'kit-notes-locked'

// How long the user must stop typing before the status flips to "Saved" —
// every keystroke still syncs instantly, this only calms the indicator down.
const SAVED_INDICATOR_DELAY_MS = 1000

const LABEL_CLASS = 'text-xs uppercase tracking-[0.12em] text-slate-400'
const PRIMARY_BUTTON = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
const ACTION_BUTTON = 'rounded-lg border px-4 py-2 text-sm font-semibold transition border-white/10 bg-white/5 text-slate-200 hover:border-white/20 hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500'
const INPUT_CLASS = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white placeholder:text-slate-500'

// Markdown with LaTeX ($inline$ and $$block$$) rendered fully client-side.
marked.use(markedKatex({ throwOnError: false }))
marked.use({ gfm: true, breaks: true, async: false })

const renderMarkdown = (text: string) => {
  const html = marked.parse(text) as string
  return DOMPurify.sanitize(html)
}

const loadLockedIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(LOCKED_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

const formatDate = (ms: number) => new Date(ms).toLocaleString()

// Styling for the rendered markdown — Tailwind resets headings/lists, so the
// preview needs its own scoped rules.
const MARKDOWN_STYLES = `
.kit-md { color: #e2e8f0; font-size: 0.9rem; line-height: 1.65; word-break: break-word; }
.kit-md h1 { font-size: 1.5rem; font-weight: 600; color: #f8fafc; margin: 0.8em 0 0.4em; }
.kit-md h2 { font-size: 1.25rem; font-weight: 600; color: #f8fafc; margin: 0.8em 0 0.4em; }
.kit-md h3 { font-size: 1.1rem; font-weight: 600; color: #f1f5f9; margin: 0.8em 0 0.4em; }
.kit-md h4, .kit-md h5, .kit-md h6 { font-weight: 600; color: #e2e8f0; margin: 0.8em 0 0.4em; }
.kit-md h1:first-child, .kit-md h2:first-child, .kit-md h3:first-child, .kit-md p:first-child { margin-top: 0; }
.kit-md p { margin: 0.5em 0; }
.kit-md ul { list-style: disc; padding-left: 1.4em; margin: 0.5em 0; }
.kit-md ol { list-style: decimal; padding-left: 1.4em; margin: 0.5em 0; }
.kit-md code { background: rgba(15, 23, 42, 0.8); border-radius: 4px; padding: 0.1em 0.35em; font-size: 0.85em; }
.kit-md pre { background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 0.75em 1em; overflow-x: auto; margin: 0.6em 0; }
.kit-md pre code { background: none; padding: 0; }
.kit-md blockquote { border-left: 3px solid rgba(96, 165, 250, 0.6); padding-left: 0.9em; margin: 0.6em 0; color: #94a3b8; }
.kit-md a { color: #93c5fd; text-decoration: underline; }
.kit-md table { border-collapse: collapse; margin: 0.6em 0; }
.kit-md th, .kit-md td { border: 1px solid rgba(255, 255, 255, 0.12); padding: 0.3em 0.7em; }
.kit-md hr { border-color: rgba(255, 255, 255, 0.12); margin: 1em 0; }
.kit-md img { max-width: 100%; border-radius: 8px; }
.kit-md .katex-display { overflow-x: auto; padding: 0.2em 0; }
`

function NotesView({ tool }: NotesViewProps) {
  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [currentId, setCurrentId] = useState('')
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [lockedIds, setLockedIds] = useState<Set<string>>(loadLockedIds)

  // Per-keystroke sync with coalescing: while one save is in flight, only the
  // latest content is kept queued, so fast typing never floods the server.
  // sessionRef guards against a response from a previous note (e.g. its
  // freshly created id) being applied after the user switched notes.
  const idRef = useRef('')
  const sessionRef = useRef(0)
  const queueRef = useRef<{ session: number; id: string; name: string; content: string } | null>(null)
  const inflightRef = useRef(false)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isLocked = currentId !== '' && lockedIds.has(currentId)

  const persistLocks = (next: Set<string>) => {
    setLockedIds(next)
    try {
      localStorage.setItem(LOCKED_STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      // Lock state is a client-side convenience only; ignore storage failures.
    }
  }

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch('/api/notes/list')
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setNotes(Array.isArray(data.notes) ? data.notes : [])
    } catch {
      setErrorMessage('Could not load the archived notes.')
    }
  }, [])

  useEffect(() => {
    refreshList()
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    }
  }, [refreshList])

  // The status pill switches to "Saved" only after the user has stopped typing
  // for a moment and every queued save has landed — saves themselves are still
  // instant, this just keeps the indicator from flickering on each keystroke.
  const scheduleSavedIndicator = useCallback(() => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => {
      if (inflightRef.current || queueRef.current) {
        scheduleSavedIndicator()
        return
      }
      setStatus((prev) => (prev === 'saving' ? 'saved' : prev))
    }, SAVED_INDICATOR_DELAY_MS)
  }, [])

  const flush = async () => {
    if (inflightRef.current) return
    inflightRef.current = true
    let ok = true
    while (queueRef.current) {
      const item = queueRef.current
      queueRef.current = null
      // Items from the current editing session always use the freshest id, so
      // the note created by the first keystroke receives the follow-up saves.
      const id = item.session === sessionRef.current ? idRef.current : item.id
      try {
        const res = await fetch('/api/notes/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name: item.name, content: item.content })
        })
        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        // The id is the filename, so naming/renaming a note changes it —
        // always adopt the server's id for the current editing session.
        if (item.session === sessionRef.current && data.id && data.id !== idRef.current) {
          idRef.current = data.id
          setCurrentId(data.id)
        }
      } catch {
        ok = false
      }
    }
    inflightRef.current = false
    if (!ok) {
      setStatus('error')
    } else {
      scheduleSavedIndicator()
    }
  }

  const queueSave = (nextName: string, nextContent: string) => {
    setErrorMessage('')
    // Don't create a file for an untouched empty editor.
    if (!idRef.current && nextContent === '' && nextName.trim() === '') return
    setStatus('saving')
    scheduleSavedIndicator()
    queueRef.current = { session: sessionRef.current, id: idRef.current, name: nextName, content: nextContent }
    void flush()
  }

  const handleChange = (text: string) => {
    setContent(text)
    queueSave(name, text)
  }

  const handleNameChange = (nextName: string) => {
    setName(nextName)
    queueSave(nextName, content)
  }

  const deleteNoteRequest = async (id: string) => {
    const res = await fetch('/api/notes/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    })
    if (!res.ok && res.status !== 404) throw new Error(await res.text())
  }

  // resetEditor closes the current note (deleting it when it is empty and
  // unnamed, so the archive doesn't collect blank "Untitled" entries) and
  // starts a fresh one.
  const resetEditor = async () => {
    const oldId = idRef.current
    const wasBlank = content.trim() === '' && name.trim() === ''
    sessionRef.current += 1
    idRef.current = ''
    setCurrentId('')
    setContent('')
    setName('')
    setStatus('idle')
    if (oldId && wasBlank) {
      try {
        await deleteNoteRequest(oldId)
      } catch {
        // A leftover empty note is harmless.
      }
    }
    await refreshList()
  }

  const openNote = async (id: string) => {
    setErrorMessage('')
    try {
      const res = await fetch(`/api/notes/get?id=${encodeURIComponent(id)}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const oldId = idRef.current
      const wasBlank = content.trim() === '' && name.trim() === ''
      sessionRef.current += 1
      idRef.current = id
      setCurrentId(id)
      setContent(typeof data.content === 'string' ? data.content : '')
      setName(typeof data.name === 'string' ? data.name : '')
      setStatus('saved')
      if (oldId && oldId !== id && wasBlank) {
        try {
          await deleteNoteRequest(oldId)
        } catch {
          // A leftover empty note is harmless.
        }
      }
      await refreshList()
    } catch {
      setErrorMessage('Could not open that note.')
    }
  }

  const deleteNote = async (id: string) => {
    if (!window.confirm('Delete this note permanently?')) return
    setErrorMessage('')
    try {
      await deleteNoteRequest(id)
      if (lockedIds.has(id)) {
        const next = new Set(lockedIds)
        next.delete(id)
        persistLocks(next)
      }
      await refreshList()
    } catch {
      setErrorMessage('Could not delete that note.')
    }
  }

  const toggleLock = (id: string) => {
    if (!id) return
    const next = new Set(lockedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    persistLocks(next)
  }

  const preview = useMemo(() => renderMarkdown(content), [content])

  // The list below the editor shows every stored note except the one open.
  const archivedNotes = notes.filter((n) => n.id !== currentId)

  const statusBadge =
    status === 'saving' ? { text: 'Saving…', cls: 'border-amber-400/50 bg-amber-400/10 text-amber-200' }
    : status === 'saved' ? { text: 'Saved', cls: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' }
    : status === 'error' ? { text: 'Sync error — retrying on next change', cls: 'border-red-400/50 bg-red-900/25 text-red-200' }
    : { text: 'New note', cls: 'border-white/10 bg-white/5 text-slate-300' }

  return (
    <div className="mx-auto max-w-6xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <style>{MARKDOWN_STYLES}</style>
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader
        tool={tool}
        subtitle="A persistent notepad with Markdown and LaTeX. Every keystroke is saved to plain text files in data/notes/ next to the app."
      />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <div className="mt-6 grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge.cls}`}>{statusBadge.text}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={`${ACTION_BUTTON} ${isLocked ? 'border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20' : ''}`}
              type="button"
              onClick={() => toggleLock(currentId)}
              disabled={!currentId}
              title="Read-only lock — a client-side guard against accidental edits"
            >
              {isLocked ? '🔒 Locked (read-only)' : '🔓 Unlocked'}
            </button>
            <button
              className={PRIMARY_BUTTON}
              type="button"
              onClick={resetEditor}
              disabled={!currentId && content === '' && name === ''}
              title="Move this note to the archive below and start a new one"
            >
              Archive &amp; New Note
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Note name (optional)</label>
          <input
            className={`${INPUT_CLASS} max-w-md ${isLocked ? 'opacity-70' : ''}`}
            type="text"
            value={name}
            readOnly={isLocked}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Shopping list — becomes the file name in data/notes/"
            maxLength={60}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-2">
            <label className={LABEL_CLASS}>Write {isLocked ? '— locked' : ''}</label>
            <textarea
              className={`min-h-[340px] w-full rounded-xl border px-4 py-3 font-mono text-sm leading-relaxed border-slate-800 bg-slate-900/70 text-white placeholder:text-slate-500 ${isLocked ? 'opacity-70' : ''}`}
              value={content}
              readOnly={isLocked}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={'Start typing…\n\n# Markdown works\n- lists, **bold**, `code`\n\nLaTeX too: $e^{i\\pi} + 1 = 0$ or block math:\n\n$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$'}
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <label className={LABEL_CLASS}>Preview</label>
            <div className="min-h-[340px] overflow-auto rounded-xl border px-4 py-3 border-white/10 bg-slate-950/70">
              {content.trim() ? (
                <div className="kit-md" dangerouslySetInnerHTML={{ __html: preview }} />
              ) : (
                <div className="text-sm text-slate-500">The rendered Markdown + LaTeX preview appears here.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-50">Archived notes</h2>
          <div className="text-xs text-slate-500">Stored as plain text in data/notes/</div>
        </div>

        {archivedNotes.length === 0 ? (
          <div className="mt-4 rounded-2xl border px-5 py-8 text-sm border-white/10 bg-white/5 text-slate-400">
            Nothing archived yet. Use “Archive &amp; New Note” to put the current note away — it stays editable from this list.
          </div>
        ) : (
          <div className="mt-4 grid gap-4">
            {archivedNotes.map((note) => {
              const locked = lockedIds.has(note.id)
              return (
                <div key={note.id} className="rounded-2xl border p-5 border-white/10 bg-white/5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openNote(note.id)}
                      title="Open this note in the editor"
                    >
                      <div className="flex items-center gap-2">
                        {locked && <span className="text-sm" aria-label="locked">🔒</span>}
                        <span className="truncate text-base font-semibold text-slate-100">{note.title}</span>
                      </div>
                      {note.preview && <div className="mt-1.5 truncate text-sm text-slate-400">{note.preview}</div>}
                      <div className="mt-1.5 text-xs text-slate-500">Edited {formatDate(note.modified)}</div>
                    </button>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button className={ACTION_BUTTON} type="button" onClick={() => openNote(note.id)}>
                        Open
                      </button>
                      <button
                        className={`${ACTION_BUTTON} ${locked ? 'border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20' : ''}`}
                        type="button"
                        onClick={() => toggleLock(note.id)}
                      >
                        {locked ? 'Unlock' : 'Lock'}
                      </button>
                      <button
                        className={`${ACTION_BUTTON} hover:border-red-400/40 hover:text-red-300`}
                        type="button"
                        onClick={() => deleteNote(note.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default NotesView
