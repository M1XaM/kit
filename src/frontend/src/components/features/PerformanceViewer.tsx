import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import FeatureHeader from './FeatureHeader'

// Charts show a strict rolling window of the last minute — anything older than
// WINDOW_MS is dropped on every sample so stale data is never kept around.
const WINDOW_MS = 60_000
const POLL_MS = 1000

// Block layout: every metric is a block the user can drag to reorder and
// resize. Sizes cycle 1×1 → 2×1 → 3×1 (full row) → 2×2; the grid is 3 columns
// wide and following blocks flow to the next line. Persisted per machine.
const LAYOUT_STORAGE_KEY = 'kit-perf-layout'
const SIZES = ['s', 'w', 'f', 'l']
const SIZE_CLASSES = {
  s: '',
  w: 'lg:col-span-2',
  f: 'lg:col-span-3',
  l: 'lg:col-span-2 lg:row-span-2'
}
const SIZE_LABELS = { s: '1×1', w: '2×1', f: '3×1', l: '2×2' }

const clampPercent = (value) => Math.max(0, Math.min(100, value))

const formatBytes = (value) => {
  if (value == null || Number.isNaN(value)) return '--'
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

const formatRate = (value) => {
  if (value == null || Number.isNaN(value)) return '--'
  return `${formatBytes(value)}/s`
}

const formatPercent = (value) => {
  if (value == null || Number.isNaN(value)) return '--'
  return `${value.toFixed(1)}%`
}

const formatTemperature = (value) => {
  if (value == null || Number.isNaN(value) || value === 0) return '--'
  return `${value.toFixed(0)} °C`
}

const formatTimestamp = (date) => {
  if (!date) return '...'
  return date.toLocaleTimeString()
}

const appendHistory = (list, entry) => {
  const cutoff = entry.time - WINDOW_MS
  return [...list, entry].filter((item) => item.time >= cutoff)
}

const loadLayout = () => {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed) && parsed.every((b) => b && typeof b.id === 'string' && SIZES.includes(b.size))) {
      return parsed
    }
  } catch { /* fall through to default */ }
  return null
}

const saveLayout = (layout) => {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch { /* layout persistence is best-effort */ }
}

const MiniChart = ({ data, lines, formatValue, tall }) => {
  if (!data.length) {
    return <div className="mt-2 text-xs text-slate-400">Collecting samples...</div>
  }

  return (
    <div className={`mt-2 ${tall ? 'h-40' : 'h-16'}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
          <Tooltip
            contentStyle={{
              background: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(148, 163, 184, 0.3)',
              borderRadius: '8px',
              fontSize: '0.75rem'
            }}
            labelFormatter={() => ''}
            formatter={(value) => formatValue(value)}
          />
          {lines.map((line) => (
            <Line
              key={line.key}
              dataKey={line.key}
              name={line.label}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// MetricBlock wraps each metric card with the drag handle and resize control.
function MetricBlock({ id, title, size, dragging, onDragStart, onDragOver, onDrop, onDragEnd, onResize, children }) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative overflow-hidden rounded-2xl border p-5 animate-rise border-white/10 bg-slate-950/70 shadow-[0_18px_40px_rgba(15,23,42,0.35)] ${SIZE_CLASSES[size]} ${dragging ? 'opacity-50' : ''}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(45,212,191,0.12),transparent_60%)] opacity-70" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <div
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title="Drag to rearrange"
            className="flex cursor-grab items-center gap-2 active:cursor-grabbing"
          >
            <span className="select-none text-slate-500" aria-hidden="true">⠿</span>
            <span className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">{title}</span>
          </div>
          <button
            type="button"
            onClick={onResize}
            title={`Size: ${SIZE_LABELS[size]} — click to resize`}
            aria-label={`Resize ${title} block (current ${SIZE_LABELS[size]})`}
            className="rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/15 hover:text-slate-200"
          >
            {SIZE_LABELS[size]}
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PerformanceViewer({ tool }) {
  const [metrics, setMetrics] = useState(null)
  const [history, setHistory] = useState({
    cpu: [],
    memory: [],
    storage: [],
    network: [],
    gpus: {}
  })
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const timerRef = useRef(null)

  // Ordered list of {id, size}; GPU blocks are added once detected.
  const [layout, setLayout] = useState(() => loadLayout() || [
    { id: 'cpu', size: 's' },
    { id: 'memory', size: 's' },
    { id: 'storage', size: 's' },
    { id: 'network', size: 's' }
  ])
  const dragIdRef = useRef(null)
  const [draggingId, setDraggingId] = useState(null)

  useEffect(() => {
    let mounted = true

    const fetchMetrics = async () => {
      try {
        const response = await fetch('/api/system/metrics', { cache: 'no-store' })
        if (!response.ok) {
          const text = await response.text()
          throw new Error(text || response.statusText)
        }
        const data = await response.json()
        if (!mounted) return

        setMetrics(data)
        setLastUpdated(new Date())
        setError('')
        setHistory((prev) => {
          const now = Date.now()
          const next = { ...prev, gpus: { ...prev.gpus } }
          next.cpu = appendHistory(prev.cpu, { time: now, value: data.cpu?.usage ?? 0 })
          next.memory = appendHistory(prev.memory, { time: now, value: data.memory?.usage ?? 0 })
          next.storage = appendHistory(prev.storage, {
            time: now,
            read: data.storage?.readBytesPerSec ?? 0,
            write: data.storage?.writeBytesPerSec ?? 0
          })
          next.network = appendHistory(prev.network, {
            time: now,
            down: data.network?.bytesRecvPerSec ?? 0,
            up: data.network?.bytesSentPerSec ?? 0
          })
          const gpus = Array.isArray(data.gpus) ? data.gpus : []
          gpus.forEach((gpu, index) => {
            if (gpu.status === 'ok') {
              next.gpus[index] = appendHistory(prev.gpus[index] || [], { time: now, value: gpu.utilization ?? 0 })
            }
          })
          return next
        })

        // Make sure every detected GPU has a block in the layout.
        const gpus = Array.isArray(data.gpus) ? data.gpus : []
        setLayout((prev) => {
          const present = new Set(prev.map((b) => b.id))
          const missing = []
          if (gpus.length === 0 && !present.has('gpu-none')) missing.push({ id: 'gpu-none', size: 's' })
          gpus.forEach((_, index) => {
            if (!present.has(`gpu-${index}`)) missing.push({ id: `gpu-${index}`, size: 's' })
          })
          if (!missing.length) return prev
          return [...prev, ...missing]
        })
      } catch (err) {
        if (!mounted) return
        setError(err.message || 'Unable to load metrics')
      }
    }

    fetchMetrics()
    timerRef.current = setInterval(fetchMetrics, POLL_MS)

    return () => {
      mounted = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const updateLayout = (next) => {
    setLayout(next)
    saveLayout(next)
  }

  const moveBlock = (fromId, toId) => {
    if (fromId === toId) return
    const next = [...layout]
    const fromIndex = next.findIndex((b) => b.id === fromId)
    const toIndex = next.findIndex((b) => b.id === toId)
    if (fromIndex < 0 || toIndex < 0) return
    const [item] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, item)
    updateLayout(next)
  }

  const resizeBlock = (id) => {
    const next = layout.map((b) =>
      b.id === id ? { ...b, size: SIZES[(SIZES.indexOf(b.size) + 1) % SIZES.length] } : b
    )
    updateLayout(next)
  }

  const cpuUsage = metrics?.cpu?.usage
  const cpuCores = metrics?.cpu?.cores
  // Approximate how many cores the current usage represents (e.g. 1/6 cores).
  const cpuCoresInUse = cpuCores && cpuUsage != null
    ? Math.round((clampPercent(cpuUsage) / 100) * cpuCores)
    : 0
  const memoryUsage = metrics?.memory?.usage
  const storageUsage = metrics?.storage?.usage
  const gpus = Array.isArray(metrics?.gpus) ? metrics.gpus : []

  const renderBlockContent = (block) => {
    const tall = block.size === 'l'
    switch (block.id) {
      case 'cpu':
        return (
          <>
            <div className="mt-1 flex items-baseline gap-2 text-2xl font-semibold text-slate-50">
              {formatPercent(cpuUsage)}
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">usage</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">{cpuCores ? `${cpuCoresInUse}/${cpuCores} cores` : 'Detecting cores...'}</div>
            <MiniChart
              data={history.cpu}
              lines={[{ key: 'value', label: 'CPU', color: '#60a5fa' }]}
              formatValue={formatPercent}
              tall={tall}
            />
          </>
        )
      case 'memory':
        return (
          <>
            <div className="mt-1 flex items-baseline gap-2 text-2xl font-semibold text-slate-50">
              {formatPercent(memoryUsage)}
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">used</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {metrics?.memory ? `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}` : 'Reading memory...'}
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-700/40">
              <div className="h-full bg-gradient-to-r from-cyan-400 to-teal-400" style={{ width: `${clampPercent(memoryUsage ?? 0)}%` }}></div>
            </div>
            <MiniChart
              data={history.memory}
              lines={[{ key: 'value', label: 'Memory', color: '#22d3ee' }]}
              formatValue={formatPercent}
              tall={tall}
            />
          </>
        )
      case 'storage':
        return (
          <>
            <div className="mt-1 flex items-baseline gap-2 text-2xl font-semibold text-slate-50">
              {formatPercent(storageUsage)}
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">used</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">
              {metrics?.storage ? `${formatBytes(metrics.storage.used)} / ${formatBytes(metrics.storage.total)}` : 'Reading storage...'}
            </div>
            <div className="mt-3 flex justify-between text-xs text-slate-200">
              <span>Read</span>
              <span>{formatRate(metrics?.storage?.readBytesPerSec)}</span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-200">
              <span>Write</span>
              <span>{formatRate(metrics?.storage?.writeBytesPerSec)}</span>
            </div>
            <MiniChart
              data={history.storage}
              lines={[
                { key: 'read', label: 'Read', color: '#34d399' },
                { key: 'write', label: 'Write', color: '#fbbf24' }
              ]}
              formatValue={formatRate}
              tall={tall}
            />
          </>
        )
      case 'network':
        return (
          <>
            <div className="mt-1 flex items-baseline gap-2 text-2xl font-semibold text-slate-50">
              {metrics?.network ? formatRate(metrics.network.bytesRecvPerSec) : '--'}
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">down</span>
            </div>
            <div className="mt-3 flex justify-between text-xs text-slate-200">
              <span>Up</span>
              <span>{formatRate(metrics?.network?.bytesSentPerSec)}</span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-200">
              <span>Packets</span>
              <span>
                {metrics?.network
                  ? `${metrics.network.packetsRecvPerSec ?? 0}/s down, ${metrics.network.packetsSentPerSec ?? 0}/s up`
                  : '--'}
              </span>
            </div>
            <MiniChart
              data={history.network}
              lines={[
                { key: 'down', label: 'Down', color: '#a855f7' },
                { key: 'up', label: 'Up', color: '#f472b6' }
              ]}
              formatValue={formatRate}
              tall={tall}
            />
          </>
        )
      default: {
        if (block.id === 'gpu-none') {
          return (
            <>
              <div className="mt-2 text-xl font-semibold text-slate-50">No GPU detected</div>
              <div className="mt-2 text-sm text-slate-400">{metrics?.gpu?.reason || 'NVIDIA, AMD and Intel adapters are probed automatically.'}</div>
            </>
          )
        }
        const index = Number(block.id.replace('gpu-', ''))
        const gpu = gpus[index]
        if (!gpu) {
          return <div className="mt-2 text-sm text-slate-400">GPU no longer detected.</div>
        }
        return (
          <>
            <div className="mt-1 flex items-baseline gap-2 text-2xl font-semibold text-slate-50">
              {formatPercent(gpu.utilization)}
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">usage</span>
            </div>
            <div className="mt-1 truncate text-sm text-slate-400" title={gpu.name}>{gpu.name || 'GPU'}</div>
            <div className="mt-3 flex justify-between text-xs text-slate-200">
              <span>Memory</span>
              <span>
                {gpu.memoryTotal
                  ? `${formatBytes(gpu.memoryUsed)} / ${formatBytes(gpu.memoryTotal)}`
                  : 'n/a'}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-200">
              <span>Temp</span>
              <span>{formatTemperature(gpu.temperature)}</span>
            </div>
            {gpu.vendor === 'intel' && (
              <div className="mt-1 text-[0.65rem] text-slate-500">Utilization approximated from GPU clock (i915 exposes no busy counter).</div>
            )}
            <MiniChart
              data={history.gpus[index] || []}
              lines={[{ key: 'value', label: 'GPU', color: '#f97316' }]}
              formatValue={formatPercent}
              tall={tall}
            />
          </>
        )
      }
    }
  }

  const blockTitle = (block) => {
    if (block.id === 'cpu') return 'CPU'
    if (block.id === 'memory') return 'Memory'
    if (block.id === 'storage') return 'Storage'
    if (block.id === 'network') return 'Network'
    if (block.id === 'gpu-none') return 'GPU'
    const index = Number(block.id.replace('gpu-', ''))
    const vendor = gpus[index]?.vendor
    const label = vendor ? vendor.toUpperCase() : ''
    return gpus.length > 1 ? `GPU ${index + 1}${label ? ` · ${label}` : ''}` : `GPU${label ? ` · ${label}` : ''}`
  }

  // Hide GPU blocks for adapters that disappeared, and the placeholder once a
  // real GPU shows up.
  const visibleLayout = layout.filter((block) => {
    if (block.id === 'gpu-none') return gpus.length === 0 && metrics
    if (block.id.startsWith('gpu-')) {
      return Number(block.id.replace('gpu-', '')) < gpus.length
    }
    return true
  })

  return (
    <div className="mx-auto max-w-5xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader
        tool={tool}
        subtitle="Live system metrics from your machine. Drag the blocks to rearrange them and click the size badge to grow a block."
      />

      {error ? (
        <div className="mb-4 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">
          Unable to refresh metrics: {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleLayout.map((block) => (
          <MetricBlock
            key={block.id}
            id={block.id}
            title={blockTitle(block)}
            size={block.size}
            dragging={draggingId === block.id}
            onDragStart={() => { dragIdRef.current = block.id; setDraggingId(block.id) }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIdRef.current) moveBlock(dragIdRef.current, block.id)
              dragIdRef.current = null
              setDraggingId(null)
            }}
            onDragEnd={() => { dragIdRef.current = null; setDraggingId(null) }}
            onResize={() => resizeBlock(block.id)}
          >
            {renderBlockContent(block)}
          </MetricBlock>
        ))}
      </div>

      <div className="mt-6 text-xs text-slate-400">
        Last updated at {formatTimestamp(lastUpdated)}. Refreshes every 1s. GPU stats come from nvidia-smi (NVIDIA) and the Linux kernel's DRM interface (AMD, Intel).
      </div>
    </div>
  )
}

export default PerformanceViewer
