import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import RuntimePill from './RuntimePill'

const HISTORY_LIMIT = 60
const POLL_MS = 1000

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
  if (value == null || Number.isNaN(value)) return '--'
  return `${value.toFixed(0)} C`
}

const formatTimestamp = (date) => {
  if (!date) return '...'
  return date.toLocaleTimeString()
}

const appendHistory = (list, entry) => {
  const next = [...list, entry]
  if (next.length > HISTORY_LIMIT) {
    return next.slice(next.length - HISTORY_LIMIT)
  }
  return next
}

const MiniChart = ({ data, lines, formatValue }) => {
  if (!data.length) {
    return <div className="mt-2 text-xs text-slate-400">Collecting samples...</div>
  }

  return (
    <div className="mt-2 h-16">
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

function PerformanceViewer({ tool }) {
  const Icon = tool.icon
  const [metrics, setMetrics] = useState(null)
  const [history, setHistory] = useState({
    cpu: [],
    memory: [],
    storage: [],
    network: [],
    gpu: []
  })
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const timerRef = useRef(null)

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
          const next = { ...prev }
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
          if (data.gpu?.status === 'ok') {
            next.gpu = appendHistory(prev.gpu, { time: now, value: data.gpu?.utilization ?? 0 })
          }
          return next
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

  const cpuUsage = metrics?.cpu?.usage
  const memoryUsage = metrics?.memory?.usage
  const storageUsage = metrics?.storage?.usage
  const gpuStatus = metrics?.gpu?.status

  const statusLabel = error ? 'Degraded' : metrics ? 'Live' : 'Connecting'
  const statusClass = error
    ? 'border-red-400/50 bg-red-900/40 text-red-200'
    : 'border-sky-400/50 bg-sky-900/40 text-sky-200'
  const cardClass = 'relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.35)] animate-rise'
  const cardOverlayClass = 'pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(45,212,191,0.12),transparent_60%)] opacity-70'

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
            <p className="text-sm text-slate-400">Live system metrics from your machine.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RuntimePill tool={tool} className="text-[0.6rem]" />
          <div className={`rounded-full border px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] ${statusClass}`}>{statusLabel}</div>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-400/50 bg-red-900/25 px-4 py-3 text-sm text-red-200">
          Unable to refresh metrics: {error}
        </div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        <div className={cardClass} style={{ animationDelay: '0ms' }}>
          <div className={cardOverlayClass} />
          <div className="relative">
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">CPU</div>
            <div className="mt-1 flex items-baseline gap-2 text-2xl font-semibold text-slate-50">
              {formatPercent(cpuUsage)}
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">usage</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">{metrics?.cpu?.cores ? `${metrics.cpu.cores} cores` : 'Detecting cores...'}</div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-700/40">
              <div className="h-full bg-gradient-to-r from-sky-400 to-fuchsia-500" style={{ width: `${clampPercent(cpuUsage ?? 0)}%` }}></div>
            </div>
            <MiniChart
              data={history.cpu}
              lines={[{ key: 'value', label: 'CPU', color: '#60a5fa' }]}
              formatValue={formatPercent}
            />
          </div>
        </div>

        <div className={cardClass} style={{ animationDelay: '80ms' }}>
          <div className={cardOverlayClass} />
          <div className="relative">
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Memory</div>
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
            />
          </div>
        </div>

        <div className={cardClass} style={{ animationDelay: '160ms' }}>
          <div className={cardOverlayClass} />
          <div className="relative">
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Storage</div>
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
            />
          </div>
        </div>

        <div className={cardClass} style={{ animationDelay: '240ms' }}>
          <div className={cardOverlayClass} />
          <div className="relative">
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">Network</div>
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
            />
          </div>
        </div>

        <div className={cardClass} style={{ animationDelay: '320ms' }}>
          <div className={cardOverlayClass} />
          <div className="relative">
            <div className="text-[0.7rem] uppercase tracking-[0.18em] text-slate-400">GPU</div>
            {gpuStatus === 'ok' ? (
              <>
                <div className="mt-1 flex items-baseline gap-2 text-2xl font-semibold text-slate-50">
                  {formatPercent(metrics?.gpu?.utilization)}
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-300">usage</span>
                </div>
                <div className="mt-1 text-sm text-slate-400">
                  {metrics?.gpu?.name ? metrics.gpu.name : 'Detected GPU'}
                </div>
                <div className="mt-3 flex justify-between text-xs text-slate-200">
                  <span>Memory</span>
                  <span>
                    {metrics?.gpu
                      ? `${formatBytes(metrics.gpu.memoryUsed)} / ${formatBytes(metrics.gpu.memoryTotal)}`
                      : '--'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-xs text-slate-200">
                  <span>Temp</span>
                  <span>{formatTemperature(metrics?.gpu?.temperature)}</span>
                </div>
                <MiniChart
                  data={history.gpu}
                  lines={[{ key: 'value', label: 'GPU', color: '#f97316' }]}
                  formatValue={formatPercent}
                />
              </>
            ) : (
              <>
                <div className="mt-2 text-xl font-semibold text-slate-50">Unavailable</div>
                <div className="mt-2 text-sm text-slate-400">{metrics?.gpu?.reason || 'GPU metrics not detected'}</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 text-xs text-slate-400">
        Last updated at {formatTimestamp(lastUpdated)}. Refreshes every 1s. GPU metrics use vendor tooling (nvidia-smi).
      </div>
    </div>
  )
}

export default PerformanceViewer
