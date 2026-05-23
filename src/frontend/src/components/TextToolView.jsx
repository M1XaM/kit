import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createMD5 } from 'hash-wasm'
import { sha1 } from '@noble/hashes/sha1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

const MAX_DIFF_LINES = 400

const INPUT_CLASS = 'w-full rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white placeholder:text-slate-500'
const LABEL_CLASS = 'text-xs uppercase tracking-[0.12em] text-slate-400'
const PRIMARY_BUTTON = 'rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400'
const SECONDARY_BUTTON = 'rounded-lg border border-slate-400/40 bg-slate-400/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-400/25 disabled:cursor-not-allowed disabled:text-slate-500'
const SUBTLE_BUTTON = 'rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/10'

const ENCODING_OPTIONS = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'iso-8859-1', label: 'ISO-8859-1' }
]

const stripExtension = (name) => name.replace(/\.[^/.]+$/, '')

const formatBytes = (value) => {
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

const normalizeLines = (value) => value.replace(/\r\n/g, '\n').split('\n')

const buildDiff = (leftText, rightText) => {
  const leftLinesFull = normalizeLines(leftText)
  const rightLinesFull = normalizeLines(rightText)
  const leftTrimmed = leftLinesFull.length > MAX_DIFF_LINES
  const rightTrimmed = rightLinesFull.length > MAX_DIFF_LINES
  const leftLines = leftTrimmed ? leftLinesFull.slice(0, MAX_DIFF_LINES) : leftLinesFull
  const rightLines = rightTrimmed ? rightLinesFull.slice(0, MAX_DIFF_LINES) : rightLinesFull
  const n = leftLines.length
  const m = rightLines.length

  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const ops = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (leftLines[i - 1] === rightLines[j - 1]) {
      ops.push({ type: 'equal', value: leftLines[i - 1] })
      i -= 1
      j -= 1
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: 'remove', value: leftLines[i - 1] })
      i -= 1
    } else {
      ops.push({ type: 'add', value: rightLines[j - 1] })
      j -= 1
    }
  }
  while (i > 0) {
    ops.push({ type: 'remove', value: leftLines[i - 1] })
    i -= 1
  }
  while (j > 0) {
    ops.push({ type: 'add', value: rightLines[j - 1] })
    j -= 1
  }

  ops.reverse()
  const stats = ops.reduce(
    (acc, item) => {
      if (item.type === 'add') acc.added += 1
      else if (item.type === 'remove') acc.removed += 1
      else acc.unchanged += 1
      return acc
    },
    { added: 0, removed: 0, unchanged: 0 }
  )

  return {
    ops,
    stats,
    trimmed: leftTrimmed || rightTrimmed
  }
}

const renderInlineMarkdown = (value) => {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  const parts = value.split(pattern).filter((part) => part !== '')

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-slate-900/70 px-1 py-0.5 text-xs text-slate-200">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('[')) {
      const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (match) {
        return (
          <a key={index} href={match[2]} target="_blank" rel="noreferrer" className="text-blue-300 underline">
            {match[1]}
          </a>
        )
      }
    }
    return <span key={index}>{part}</span>
  })
}

const renderMarkdownBlocks = (value) => {
  const lines = normalizeLines(value)
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const codeLines = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      blocks.push(
        <pre key={`code-${i}`} className="overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-slate-200">
          <code>{codeLines.join('\n')}</code>
        </pre>
      )
      i += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const content = headingMatch[2]
      const Tag = `h${level}`
      const headingClass = level === 1
        ? 'text-2xl font-semibold text-slate-50'
        : level === 2
          ? 'text-xl font-semibold text-slate-50'
          : level === 3
            ? 'text-lg font-semibold text-slate-100'
            : 'text-base font-semibold text-slate-200'
      blocks.push(
        <Tag key={`heading-${i}`} className={headingClass}>
          {renderInlineMarkdown(content)}
        </Tag>
      )
      i += 1
      continue
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/)
    if (orderedMatch) {
      const items = []
      while (i < lines.length) {
        const match = lines[i].match(/^\s*\d+\.\s+(.*)$/)
        if (!match) break
        items.push(match[1])
        i += 1
      }
      blocks.push(
        <ol key={`ol-${i}`} className="list-decimal space-y-1 pl-6 text-sm text-slate-200">
          {items.map((item, index) => (
            <li key={index}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.*)$/)
    if (unorderedMatch) {
      const items = []
      while (i < lines.length) {
        const match = lines[i].match(/^\s*[-*]\s+(.*)$/)
        if (!match) break
        items.push(match[1])
        i += 1
      }
      blocks.push(
        <ul key={`ul-${i}`} className="list-disc space-y-1 pl-6 text-sm text-slate-200">
          {items.map((item, index) => (
            <li key={index}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (line.startsWith('> ')) {
      blocks.push(
        <blockquote key={`quote-${i}`} className="rounded-lg border-l-4 border-blue-400/60 bg-blue-900/10 p-3 text-sm text-slate-200">
          {renderInlineMarkdown(line.slice(2))}
        </blockquote>
      )
      i += 1
      continue
    }

    if (line.trim() === '') {
      blocks.push(<div key={`spacer-${i}`} className="h-3" />)
      i += 1
      continue
    }

    blocks.push(
      <p key={`p-${i}`} className="text-sm text-slate-200">
        {renderInlineMarkdown(line)}
      </p>
    )
    i += 1
  }

  return blocks
}

function ToolShell({ tool, subtitle, children }) {
  const Icon = tool.icon
  return (
    <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-white/5 p-10 text-left backdrop-blur">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${tool.colorClass}`}>
            {Icon ? <Icon /> : null}
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-50">{tool.title}</h2>
            <p className="text-sm text-slate-400">{subtitle || tool.description}</p>
          </div>
        </div>
        <div className="rounded-full border border-emerald-400/40 bg-emerald-900/40 px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-emerald-200">
          Client-side
        </div>
      </div>
      {children}
    </div>
  )
}

function MetadataEditor() {
  const fileInputRef = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [subject, setSubject] = useState('')
  const [keywords, setKeywords] = useState('')
  const [customJson, setCustomJson] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const dropZoneClass = `flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center text-slate-400 transition ${dragActive ? 'border-blue-400/70 bg-blue-600/20 text-slate-200' : 'border-white/20 hover:border-white/30 hover:bg-white/5'}`

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
      setSelectedFile(files[0])
      setErrorMessage('')
    }
  }

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || [])
    if (files.length) {
      setSelectedFile(files[0])
      setErrorMessage('')
    }
  }

  const customParsed = (() => {
    if (!customJson.trim()) return { value: null, error: '' }
    try {
      return { value: JSON.parse(customJson), error: '' }
    } catch (err) {
      return { value: null, error: 'Invalid JSON in custom metadata.' }
    }
  })()

  const metadata = useMemo(() => {
    const meta = {}
    if (selectedFile) {
      meta.file = {
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type || 'unknown',
        lastModified: selectedFile.lastModified ? new Date(selectedFile.lastModified).toISOString() : null
      }
    }
    if (title.trim()) meta.title = title.trim()
    if (author.trim()) meta.author = author.trim()
    if (subject.trim()) meta.subject = subject.trim()
    const keywordList = keywords.split(',').map((item) => item.trim()).filter(Boolean)
    if (keywordList.length) meta.keywords = keywordList
    if (customParsed.value) meta.custom = customParsed.value
    return meta
  }, [selectedFile, title, author, subject, keywords, customParsed.value])

  const metadataJson = JSON.stringify(metadata, null, 2)

  const downloadMetadata = () => {
    if (customParsed.error) {
      setErrorMessage(customParsed.error)
      return
    }
    const base = selectedFile ? stripExtension(selectedFile.name) : 'metadata'
    const blob = new Blob([metadataJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${base}.metadata.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setErrorMessage('')
  }

  const copyMetadata = async () => {
    if (customParsed.error) {
      setErrorMessage(customParsed.error)
      return
    }
    try {
      await navigator.clipboard.writeText(metadataJson)
      setErrorMessage('')
    } catch (err) {
      setErrorMessage('Unable to copy metadata to clipboard.')
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
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
            {selectedFile ? selectedFile.name : 'Drop a file to read basic metadata'}
          </div>
          <div className="mt-2 text-xs text-slate-400">or click to choose a file</div>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
        </label>

        {selectedFile ? (
          <div className="flex flex-wrap gap-3 rounded-xl border border-white/10 bg-slate-900/50 px-4 py-3 text-xs text-slate-300">
            <span>Name: {selectedFile.name}</span>
            <span>Size: {formatBytes(selectedFile.size)}</span>
            <span>Type: {selectedFile.type || 'unknown'}</span>
            <span>Modified: {selectedFile.lastModified ? new Date(selectedFile.lastModified).toLocaleString() : 'unknown'}</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Title</label>
          <input className={INPUT_CLASS} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Document title" />
        </div>
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Author</label>
          <input className={INPUT_CLASS} value={author} onChange={(event) => setAuthor(event.target.value)} placeholder="Author name" />
        </div>
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Subject</label>
          <input className={INPUT_CLASS} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject or category" />
        </div>
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Keywords</label>
          <input className={INPUT_CLASS} value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="keyword1, keyword2" />
        </div>
      </div>

      <div className="grid gap-2">
        <label className={LABEL_CLASS}>Custom JSON metadata</label>
        <textarea
          className={`${INPUT_CLASS} min-h-[120px] font-mono`}
          value={customJson}
          onChange={(event) => setCustomJson(event.target.value)}
          placeholder='{"department":"Design","version":"1.2"}'
        />
        {customParsed.error ? <div className="text-xs text-red-300">{customParsed.error}</div> : null}
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{errorMessage}</div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button className={PRIMARY_BUTTON} type="button" onClick={downloadMetadata}>
          Download metadata JSON
        </button>
        <button className={SECONDARY_BUTTON} type="button" onClick={copyMetadata}>
          Copy JSON
        </button>
        <span className="text-xs text-slate-400">Exports a sidecar file, original file is unchanged.</span>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/30 p-4">
        <div className={LABEL_CLASS}>Preview</div>
        <pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-200">{metadataJson}</pre>
      </div>
    </div>
  )
}

function DiffViewer({ diff }) {
  let leftLine = 0
  let rightLine = 0

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
      <div className="grid grid-cols-[40px_40px_1fr] gap-2 border-b border-white/10 px-3 py-2 text-[0.7rem] uppercase tracking-[0.14em] text-slate-400">
        <span>Left</span>
        <span>Right</span>
        <span>Line</span>
      </div>
      <div className="max-h-[320px] overflow-auto font-mono text-xs">
        {diff.ops.map((entry, index) => {
          const isAdd = entry.type === 'add'
          const isRemove = entry.type === 'remove'
          const isEqual = entry.type === 'equal'
          const leftIndex = isAdd ? '' : String(++leftLine)
          const rightIndex = isRemove ? '' : String(++rightLine)
          const rowClass = isAdd
            ? 'bg-emerald-900/25 text-emerald-200'
            : isRemove
              ? 'bg-red-900/25 text-red-200'
              : 'text-slate-300'

          return (
            <div key={`${entry.type}-${index}`} className={`grid grid-cols-[40px_40px_1fr] gap-2 px-3 py-1 ${rowClass}`}>
              <span className="text-slate-500">{leftIndex}</span>
              <span className="text-slate-500">{rightIndex}</span>
              <span className="whitespace-pre-wrap break-words">{entry.value || ' '}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TextCompareTool() {
  const [leftText, setLeftText] = useState('')
  const [rightText, setRightText] = useState('')
  const [diffResult, setDiffResult] = useState(null)

  const runCompare = () => {
    setDiffResult(buildDiff(leftText, rightText))
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Original</label>
          <textarea
            className={`${INPUT_CLASS} min-h-[180px] font-mono`}
            value={leftText}
            onChange={(event) => setLeftText(event.target.value)}
            placeholder="Paste the original text"
          />
        </div>
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Modified</label>
          <textarea
            className={`${INPUT_CLASS} min-h-[180px] font-mono`}
            value={rightText}
            onChange={(event) => setRightText(event.target.value)}
            placeholder="Paste the updated text"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={PRIMARY_BUTTON} type="button" onClick={runCompare}>
          Compare text
        </button>
        <button className={SUBTLE_BUTTON} type="button" onClick={() => {
          setLeftText(rightText)
          setRightText(leftText)
        }}>
          Swap
        </button>
      </div>

      {diffResult ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <span>Added: {diffResult.stats.added}</span>
            <span>Removed: {diffResult.stats.removed}</span>
            <span>Unchanged: {diffResult.stats.unchanged}</span>
            {diffResult.trimmed ? <span className="text-amber-200">Diff trimmed to {MAX_DIFF_LINES} lines per side.</span> : null}
          </div>
          <DiffViewer diff={diffResult} />
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-6 text-sm text-slate-400">
          Run a compare to see the line diff.
        </div>
      )}
    </div>
  )
}

function MarkdownDiffTool() {
  const [leftText, setLeftText] = useState('')
  const [rightText, setRightText] = useState('')
  const [diffResult, setDiffResult] = useState(null)

  const leftPreview = useMemo(() => renderMarkdownBlocks(leftText), [leftText])
  const rightPreview = useMemo(() => renderMarkdownBlocks(rightText), [rightText])

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Markdown A</label>
          <textarea
            className={`${INPUT_CLASS} min-h-[200px] font-mono`}
            value={leftText}
            onChange={(event) => setLeftText(event.target.value)}
            placeholder="Write markdown here"
          />
        </div>
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Markdown B</label>
          <textarea
            className={`${INPUT_CLASS} min-h-[200px] font-mono`}
            value={rightText}
            onChange={(event) => setRightText(event.target.value)}
            placeholder="Write markdown here"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
          <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Preview A</div>
          <div className="mt-3 space-y-3">{leftPreview}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
          <div className="text-xs uppercase tracking-[0.12em] text-slate-400">Preview B</div>
          <div className="mt-3 space-y-3">{rightPreview}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          className={PRIMARY_BUTTON}
          type="button"
          onClick={() => setDiffResult(buildDiff(leftText, rightText))}
        >
          Compare markdown
        </button>
        <button className={SUBTLE_BUTTON} type="button" onClick={() => {
          setLeftText(rightText)
          setRightText(leftText)
        }}>
          Swap
        </button>
      </div>

      {diffResult ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            <span>Added: {diffResult.stats.added}</span>
            <span>Removed: {diffResult.stats.removed}</span>
            <span>Unchanged: {diffResult.stats.unchanged}</span>
            {diffResult.trimmed ? <span className="text-amber-200">Diff trimmed to {MAX_DIFF_LINES} lines per side.</span> : null}
          </div>
          <DiffViewer diff={diffResult} />
        </div>
      ) : null}
    </div>
  )
}

function HashGeneratorTool() {
  const [text, setText] = useState('')
  const [algorithm, setAlgorithm] = useState('sha256')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [isWorking, setIsWorking] = useState(false)

  const handleGenerate = async () => {
    setIsWorking(true)
    setError('')
    try {
      const data = new TextEncoder().encode(text)
      if (algorithm === 'md5') {
        const hasher = await createMD5()
        hasher.update(data)
        const digest = hasher.digest()
        setResult(typeof digest === 'string' ? digest.toLowerCase() : bytesToHex(digest))
      } else if (algorithm === 'sha1') {
        const hasher = sha1.create()
        hasher.update(data)
        setResult(bytesToHex(hasher.digest()))
      } else {
        const hasher = sha256.create()
        hasher.update(data)
        setResult(bytesToHex(hasher.digest()))
      }
    } catch (err) {
      setError('Failed to generate hash.')
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <label className={LABEL_CLASS}>Text input</label>
        <textarea
          className={`${INPUT_CLASS} min-h-[160px] font-mono`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Type or paste text"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-2">
          <label className={LABEL_CLASS}>Algorithm</label>
          <select className={INPUT_CLASS} value={algorithm} onChange={(event) => setAlgorithm(event.target.value)}>
            <option value="sha256">SHA-256</option>
            <option value="sha1">SHA-1</option>
            <option value="md5">MD5</option>
          </select>
        </div>
        <button className={PRIMARY_BUTTON} type="button" onClick={handleGenerate} disabled={isWorking}>
          {isWorking ? 'Generating...' : 'Generate hash'}
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <div className="grid gap-2">
        <label className={LABEL_CLASS}>Output</label>
        <textarea className={`${INPUT_CLASS} min-h-[120px] font-mono`} value={result} readOnly placeholder="Hash output" />
      </div>
    </div>
  )
}

function TransformTool({ encodeLabel, decodeLabel, encode, decode, inputPlaceholder, outputPlaceholder }) {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const handleEncode = () => {
    try {
      setOutput(encode(input))
      setError('')
    } catch (err) {
      setError('Unable to encode input.')
    }
  }

  const handleDecode = () => {
    try {
      setOutput(decode(input))
      setError('')
    } catch (err) {
      setError('Unable to decode input.')
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output)
    } catch (err) {
      setError('Unable to copy output to clipboard.')
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <label className={LABEL_CLASS}>Input</label>
        <textarea
          className={`${INPUT_CLASS} min-h-[160px] font-mono`}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={inputPlaceholder}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={PRIMARY_BUTTON} type="button" onClick={handleEncode}>
          {encodeLabel}
        </button>
        <button className={SECONDARY_BUTTON} type="button" onClick={handleDecode}>
          {decodeLabel}
        </button>
        <button className={SUBTLE_BUTTON} type="button" onClick={() => {
          setInput(output)
          setOutput('')
        }}>
          Swap output to input
        </button>
        <button className={SUBTLE_BUTTON} type="button" onClick={() => {
          setInput('')
          setOutput('')
        }}>
          Clear
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <div className="grid gap-2">
        <label className={LABEL_CLASS}>Output</label>
        <textarea
          className={`${INPUT_CLASS} min-h-[140px] font-mono`}
          value={output}
          readOnly
          placeholder={outputPlaceholder}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={SUBTLE_BUTTON} type="button" onClick={handleCopy} disabled={!output}>
          Copy output
        </button>
      </div>
    </div>
  )
}

const encodeBase64 = (value) => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

const decodeBase64 = (value) => {
  const cleaned = value.trim()
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

const encodeHex = (value) => bytesToHex(new TextEncoder().encode(value))

const decodeHex = (value) => {
  const cleaned = value.replace(/[^a-fA-F0-9]/g, '')
  if (cleaned.length % 2 !== 0) {
    throw new Error('Hex length must be even')
  }
  const bytes = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16)
  }
  return new TextDecoder().decode(bytes)
}

const encodeUrl = (value) => encodeURIComponent(value)
const decodeUrl = (value) => decodeURIComponent(value.replace(/\+/g, ' '))

const encodeUtf16 = (value, littleEndian) => {
  const buffer = new ArrayBuffer(value.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < value.length; i += 1) {
    view.setUint16(i * 2, value.charCodeAt(i), littleEndian)
  }
  return new Uint8Array(buffer)
}

const encodeLatin1 = (value) => {
  const bytes = new Uint8Array(value.length)
  let replaced = 0
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 255) {
      bytes[i] = code
    } else {
      bytes[i] = 63
      replaced += 1
    }
  }
  return { bytes, replaced }
}

function EncodingConvertTool() {
  const fileInputRef = useRef(null)
  const [inputText, setInputText] = useState('')
  const [inputEncoding, setInputEncoding] = useState('utf-8')
  const [outputEncoding, setOutputEncoding] = useState('utf-8')
  const [outputText, setOutputText] = useState('')
  const [outputBytes, setOutputBytes] = useState(null)
  const [replacementCount, setReplacementCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')

  const decodeBytes = (buffer, encoding) => {
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch (err) {
      return new TextDecoder().decode(buffer)
    }
  }

  const handleFilePick = (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    const file = files[0]
    file.arrayBuffer().then((buffer) => {
      const text = decodeBytes(buffer, inputEncoding)
      setInputText(text)
      setErrorMessage('')
    }).catch(() => {
      setErrorMessage('Unable to read the file with the selected encoding.')
    })
  }

  const convertText = () => {
    setErrorMessage('')
    let bytes
    let replaced = 0

    if (outputEncoding === 'utf-8') {
      bytes = new TextEncoder().encode(inputText)
    } else if (outputEncoding === 'utf-16le') {
      bytes = encodeUtf16(inputText, true)
    } else if (outputEncoding === 'utf-16be') {
      bytes = encodeUtf16(inputText, false)
    } else {
      const result = encodeLatin1(inputText)
      bytes = result.bytes
      replaced = result.replaced
    }

    setOutputBytes(bytes)
    setReplacementCount(replaced)
    setOutputText(decodeBytes(bytes, outputEncoding))
  }

  const downloadOutput = () => {
    if (!outputBytes) return
    const extension = outputEncoding.replace(/[^a-z0-9]+/g, '-')
    const blob = new Blob([outputBytes], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `converted-${extension}.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <button className={SUBTLE_BUTTON} type="button" onClick={() => fileInputRef.current?.click()}>
          Load text file
        </button>
        <input ref={fileInputRef} type="file" accept="text/*" className="hidden" onChange={handleFilePick} />
        <span className="text-xs text-slate-400">Files are read locally, nothing is uploaded.</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Input encoding</label>
          <select className={INPUT_CLASS} value={inputEncoding} onChange={(event) => setInputEncoding(event.target.value)}>
            {ENCODING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <label className={LABEL_CLASS}>Output encoding</label>
          <select className={INPUT_CLASS} value={outputEncoding} onChange={(event) => setOutputEncoding(event.target.value)}>
            {ENCODING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-2">
        <label className={LABEL_CLASS}>Input text</label>
        <textarea
          className={`${INPUT_CLASS} min-h-[160px] font-mono`}
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          placeholder="Paste text to convert"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className={PRIMARY_BUTTON} type="button" onClick={convertText}>
          Convert encoding
        </button>
        <button className={SECONDARY_BUTTON} type="button" onClick={downloadOutput} disabled={!outputBytes}>
          Download converted file
        </button>
        {outputBytes ? <span className="text-xs text-slate-400">Output size: {formatBytes(outputBytes.length)}</span> : null}
        {replacementCount ? <span className="text-xs text-amber-200">Replaced {replacementCount} unsupported characters.</span> : null}
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">{errorMessage}</div>
      ) : null}

      <div className="grid gap-2">
        <label className={LABEL_CLASS}>Output preview</label>
        <textarea
          className={`${INPUT_CLASS} min-h-[140px] font-mono`}
          value={outputText}
          readOnly
          placeholder="Converted text preview"
        />
      </div>
    </div>
  )
}

function TextToolView({ tool }) {
  if (tool.id === 'metadata-edit') {
    return (
      <ToolShell tool={tool} subtitle="Export metadata sidecars without leaving the browser.">
        <MetadataEditor />
      </ToolShell>
    )
  }

  if (tool.id === 'text-compare') {
    return (
      <ToolShell tool={tool} subtitle="Client-side text compare with line-by-line diff.">
        <TextCompareTool />
      </ToolShell>
    )
  }

  if (tool.id === 'markdown-diff') {
    return (
      <ToolShell tool={tool} subtitle="Preview Markdown and compare revisions locally.">
        <MarkdownDiffTool />
      </ToolShell>
    )
  }

  if (tool.id === 'hash-generator') {
    return (
      <ToolShell tool={tool} subtitle="Generate hashes locally. Nothing leaves your browser.">
        <HashGeneratorTool />
      </ToolShell>
    )
  }

  if (tool.id === 'base64-encode-decode') {
    return (
      <ToolShell tool={tool} subtitle="Encode and decode Base64 text locally.">
        <TransformTool
          encodeLabel="Encode Base64"
          decodeLabel="Decode Base64"
          encode={encodeBase64}
          decode={decodeBase64}
          inputPlaceholder="Paste text or Base64 here"
          outputPlaceholder="Base64 output"
        />
      </ToolShell>
    )
  }

  if (tool.id === 'hex-encode-decode') {
    return (
      <ToolShell tool={tool} subtitle="Convert text to and from hexadecimal locally.">
        <TransformTool
          encodeLabel="Encode Hex"
          decodeLabel="Decode Hex"
          encode={encodeHex}
          decode={decodeHex}
          inputPlaceholder="Paste text or hex here"
          outputPlaceholder="Hex output"
        />
      </ToolShell>
    )
  }

  if (tool.id === 'url-encode-decode') {
    return (
      <ToolShell tool={tool} subtitle="Encode or decode URL strings in your browser.">
        <TransformTool
          encodeLabel="Encode URL"
          decodeLabel="Decode URL"
          encode={encodeUrl}
          decode={decodeUrl}
          inputPlaceholder="Paste text or URL-encoded string"
          outputPlaceholder="URL output"
        />
      </ToolShell>
    )
  }

  if (tool.id === 'text-encoding-convert') {
    return (
      <ToolShell tool={tool} subtitle="Convert text between common encodings locally.">
        <EncodingConvertTool />
      </ToolShell>
    )
  }

  return (
    <ToolShell tool={tool} subtitle="This tool is not available yet.">
      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-6 text-sm text-slate-400">
        This tool is still in progress.
      </div>
    </ToolShell>
  )
}

export default TextToolView
