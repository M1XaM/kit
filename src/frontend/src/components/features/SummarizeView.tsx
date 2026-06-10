import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import FeatureHeader from './FeatureHeader'

// AI Summarize. A local sequence-to-sequence model (T5 family) condenses text.
// Inference runs in a bundled sidecar on the Go backend (GPU via CUDA when
// available, else CPU). This view mirrors AI Remove Background: live machine
// specs, a model dropdown with download/delete and a Recommended flag — but the
// work area is a two-pane editor: paste text on the left, read the summary on
// the right.

const METRICS_POLL_MS = 1000
const MODELS_POLL_MS = 1500
const WINDOW_MS = 60_000

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

const formatPercent = (value) => (value == null || Number.isNaN(value) ? '--' : `${value.toFixed(0)}%`)

const TIER_ORDER = { light: 0, medium: 1, strong: 2 }
const TIER_BADGES = {
  light: { label: 'Light', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' },
  medium: { label: 'Medium', cls: 'border-amber-400/40 bg-amber-500/15 text-amber-200' },
  strong: { label: 'Strong', cls: 'border-rose-400/40 bg-rose-500/15 text-rose-200' }
}

const appendHistory = (list, entry) => {
  const cutoff = entry.time - WINDOW_MS
  return [...list, entry].filter((item) => item.time >= cutoff)
}

const MiniChart = ({ data, color, formatValue }) => {
  if (!data.length) return <div className="mt-2 text-xs text-slate-400">Collecting samples…</div>
  return (
    <div className="mt-2 h-16">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <Tooltip
            contentStyle={{ background: 'rgba(15,23,42,0.9)', border: '1px solid rgba(148,163,184,0.3)', borderRadius: 8, fontSize: '0.75rem' }}
            labelFormatter={() => ''}
            formatter={(value) => formatValue(value)}
          />
          <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

const SpecCard = ({ title, value, sub, data, color, formatValue }) => (
  <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
    <div className="text-[0.7rem] uppercase tracking-[0.16em] text-slate-400">{title}</div>
    <div className="mt-1 text-xl font-semibold text-slate-50">{value}</div>
    {sub && <div className="text-xs text-slate-400">{sub}</div>}
    <MiniChart data={data} color={color} formatValue={formatValue} />
  </div>
)

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white'

function SummarizeView({ tool }) {
  const [metrics, setMetrics] = useState(null)
  const [metricsError, setMetricsError] = useState('')
  const [history, setHistory] = useState({ cpu: [], memory: [], gpu: [], gpuMem: [] })
  const [showSpecs, setShowSpecs] = useState(false)

  const [data, setData] = useState({ engineAvailable: true, models: [] })
  const [selectedId, setSelectedId] = useState('')

  const [text, setText] = useState('')
  const [summary, setSummary] = useState('')
  const [usedProvider, setUsedProvider] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)

  // Live system metrics + rolling history for the graphs.
  useEffect(() => {
    let mounted = true
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/system/metrics', { cache: 'no-store' })
        if (!res.ok) throw new Error(await res.text())
        const json = await res.json()
        if (!mounted) return
        setMetrics(json)
        setMetricsError('')
        const now = Date.now()
        setHistory((prev) => ({
          cpu: appendHistory(prev.cpu, { time: now, value: json.cpu?.usage ?? 0 }),
          memory: appendHistory(prev.memory, { time: now, value: json.memory?.usage ?? 0 }),
          gpu: json.gpu?.status === 'ok' ? appendHistory(prev.gpu, { time: now, value: json.gpu?.utilization ?? 0 }) : prev.gpu,
          gpuMem: json.gpu?.status === 'ok' ? appendHistory(prev.gpuMem, { time: now, value: json.gpu?.memoryUtilization ?? 0 }) : prev.gpuMem
        }))
      } catch (err) {
        if (mounted) setMetricsError(err instanceof Error ? err.message : 'Failed to read system metrics')
      }
    }
    fetchMetrics()
    const timer = setInterval(fetchMetrics, METRICS_POLL_MS)
    return () => { mounted = false; clearInterval(timer) }
  }, [])

  // Model registry + download state, polled so progress stays live.
  useEffect(() => {
    let mounted = true
    const fetchModels = async () => {
      try {
        const res = await fetch('/api/ai/summarize/models', { cache: 'no-store' })
        if (!res.ok) throw new Error(await res.text())
        const json = await res.json()
        if (mounted) setData(json)
      } catch { /* keep last known state */ }
    }
    fetchModels()
    const timer = setInterval(fetchModels, MODELS_POLL_MS)
    return () => { mounted = false; clearInterval(timer) }
  }, [])

  const memTotal = metrics?.memory?.total
  const memAvailable = metrics?.memory?.available
  const gpu = metrics?.gpu
  const gpuPresent = gpu?.status === 'ok'
  const gpuVram = gpu?.memoryTotal

  const evaluate = (model) => {
    const enoughRam = memTotal != null ? memTotal >= model.minRamBytes : true
    const lowAvailable = enoughRam && memAvailable != null && memAvailable < model.minRamBytes
    const slowOnCpu = model.gpuRecommended && !gpuPresent
    const gpuFits = gpuPresent && (!model.recommendVramBytes || (gpuVram != null && gpuVram >= model.recommendVramBytes))
    return { canRun: enoughRam, enoughRam, lowAvailable, slowOnCpu, gpuFits }
  }

  const models = data.models || []

  // Recommend the best tier for this machine: with a capable GPU, the strongest
  // model that fits VRAM; on CPU-only, the strongest model that isn't a
  // GPU-recommended (heavy) one.
  const recommendedId = useMemo(() => {
    const runnable = models.filter((m) => evaluate(m).canRun)
    if (!runnable.length) return ''
    const strongestFirst = (list) => [...list].sort((a, b) => TIER_ORDER[b.tier] - TIER_ORDER[a.tier])
    if (gpuPresent) {
      const fit = runnable.filter((m) => evaluate(m).gpuFits)
      return strongestFirst(fit.length ? fit : runnable)[0]?.id || ''
    }
    const cpuFriendly = runnable.filter((m) => !m.gpuRecommended)
    return strongestFirst(cpuFriendly.length ? cpuFriendly : runnable)[0]?.id || ''
  }, [models, memTotal, memAvailable, gpuPresent, gpuVram])

  const selectedModel = useMemo(() => models.find((m) => m.id === selectedId), [models, selectedId])
  const selectedEval = selectedModel ? evaluate(selectedModel) : null

  const postId = async (path, id) => {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
    })
    if (!res.ok && res.status !== 202) throw new Error(await res.text())
  }
  const handleDownload = async (id) => {
    try { await postId('/api/ai/summarize/models/download', id) }
    catch (err) { setErrorMessage(err instanceof Error ? err.message : 'Download failed to start') }
  }
  const handleDelete = async (id) => {
    try { await postId('/api/ai/summarize/models/delete', id); if (selectedId === id) setUsedProvider('') }
    catch (err) { setErrorMessage(err instanceof Error ? err.message : 'Could not delete model') }
  }

  const trimmed = text.trim()
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0
  const canSubmit = data.engineAvailable && selectedModel?.downloaded && selectedEval?.canRun && trimmed.length > 0 && !isProcessing

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return
    setIsProcessing(true); setErrorMessage(''); setSummary(''); setUsedProvider('')
    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selectedModel.id, text: trimmed })
      })
      if (!res.ok) throw new Error((await res.text()) || res.statusText)
      const json = await res.json()
      setSummary(json.summary || '')
      setUsedProvider(json.provider || '')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Summarization failed')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked; ignore */ }
  }

  const providerLabel = (p) => (p === 'cuda' ? 'GPU (CUDA)' : p === 'cpu' ? 'CPU' : p)
  const specSummary = metrics
    ? `RAM ${formatBytes(memAvailable)} free • ${gpuPresent ? (gpu?.name || 'GPU') : 'No GPU'} • ${metrics?.cpu?.cores ?? '?'} cores`
    : 'Reading system specs…'

  return (
    <div className="mx-auto max-w-5xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle="A local AI model condenses your text — nothing ever leaves your machine." />

      {!data.engineAvailable && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-amber-400/50 bg-amber-900/25 text-amber-200">
          <p className="font-semibold text-amber-100">AI summarization isn’t available in this build.</p>
          <p className="mt-1">
            Inference runs in a small engine bundled next to the app, and Kit couldn’t find it here. The official
            releases ship it for <span className="text-amber-100">Linux</span>, <span className="text-amber-100">Windows</span>{' '}
            and <span className="text-amber-100">macOS (Apple Silicon)</span>, so this usually means you’re on a different
            architecture, or you built Kit from source on a machine without a C/Go toolchain — in which case the engine is
            skipped and the rest of Kit still works normally.
          </p>
          <p className="mt-1">
            To enable it, grab an{' '}
            <a className="underline hover:text-amber-100" href="https://github.com/M1XaM/kit/releases" target="_blank" rel="noreferrer">
              official release
            </a>{' '}
            for your platform, or rebuild from source with <code className="rounded bg-black/30 px-1">make build</code>{' '}
            (Docker sets up everything, including the engine).
          </p>
        </div>
      )}

      {/* Collapsible live specs with graphs (hidden by default) */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
        <button
          type="button"
          onClick={() => setShowSpecs((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
            </svg>
            System monitor
          </span>
          <span className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-400 sm:inline">{specSummary}</span>
            <svg className={`transition-transform ${showSpecs ? 'rotate-180' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>

        {showSpecs && (
          <div className="border-t border-white/10 p-4">
            {metricsError ? (
              <div className="rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{metricsError}</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SpecCard
                  title="Memory"
                  value={`${formatBytes(memAvailable)} free`}
                  sub={memTotal != null ? `of ${formatBytes(memTotal)}` : ''}
                  data={history.memory} color="#34d399" formatValue={formatPercent}
                />
                <SpecCard
                  title="CPU"
                  value={metrics?.cpu?.cores != null ? `${metrics.cpu.cores} cores` : '…'}
                  sub={metrics?.cpu?.usage != null ? `${metrics.cpu.usage.toFixed(0)}% in use` : ''}
                  data={history.cpu} color="#60a5fa" formatValue={formatPercent}
                />
                <SpecCard
                  title="GPU"
                  value={gpuPresent ? (gpu?.name || 'Detected') : 'None'}
                  sub={gpuPresent ? `${gpu.utilization?.toFixed(0) ?? 0}% util` : (gpu?.reason || 'CPU inference')}
                  data={history.gpu} color="#f472b6" formatValue={formatPercent}
                />
                <SpecCard
                  title="GPU memory"
                  value={gpuPresent && gpuVram ? formatBytes(gpuVram) : '--'}
                  sub={gpuPresent ? `${gpu.memoryUtilization?.toFixed(0) ?? 0}% used` : 'no GPU'}
                  data={history.gpuMem} color="#a78bfa" formatValue={formatPercent}
                />
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">Inference uses your GPU when a compatible NVIDIA GPU is available, otherwise the CPU. These graphs update live.</p>
          </div>
        )}
      </div>

      {/* Model dropdown */}
      <div className="mt-6">
        <label className={labelClass}>Model</label>
        <select className={inputClass} value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setSummary(''); setUsedProvider('') }}>
          <option value="">Select a model…</option>
          {models.map((m) => {
            const ev = evaluate(m)
            const tags = [TIER_BADGES[m.tier].label, formatBytes(m.sizeBytes)]
            if (m.id === recommendedId) tags.push('Recommended')
            if (!ev.canRun) tags.push('not enough resources')
            else if (!m.downloaded) tags.push('not downloaded')
            return (
              <option key={m.id} value={m.id}>{`${m.name} — ${tags.join(' • ')}`}</option>
            )
          })}
        </select>
      </div>

      {/* Selected model detail + actions */}
      {selectedModel && selectedEval && (
        <div className={`mt-4 rounded-xl border p-4 ${selectedEval.canRun ? 'border-white/10 bg-white/5' : 'border-red-400/30 bg-red-900/10'}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-100">{selectedModel.name}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider ${TIER_BADGES[selectedModel.tier].cls}`}>{TIER_BADGES[selectedModel.tier].label}</span>
                {selectedModel.id === recommendedId && (
                  <span className="rounded-full bg-blue-500/90 px-2 py-0.5 text-[0.6rem] font-bold text-white">Recommended</span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-400">{selectedModel.description}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>Download: <span className="text-slate-200">{formatBytes(selectedModel.sizeBytes)}</span></span>
                <span>Needs RAM: <span className="text-slate-200">{formatBytes(selectedModel.minRamBytes)}</span></span>
                <span>{gpuPresent ? (selectedEval.gpuFits ? 'Will use your GPU' : 'Will use GPU (may fall back to CPU)') : 'Will run on CPU'}</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {!selectedEval.canRun ? (
                <span className="rounded-full border border-red-400/50 bg-red-900/30 px-3 py-1 text-xs font-semibold text-red-200">Not enough resources</span>
              ) : selectedModel.downloaded ? (
                <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">Downloaded</span>
              ) : selectedModel.downloading ? (
                <div className="w-40">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${selectedModel.progress || 0}%` }} />
                  </div>
                  <div className="mt-1 text-right text-xs text-slate-400">{Math.round(selectedModel.progress || 0)}%</div>
                </div>
              ) : (
                <button type="button" onClick={() => handleDownload(selectedModel.id)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700">
                  Download
                </button>
              )}
              {selectedModel.downloaded && (
                <button type="button" onClick={() => handleDelete(selectedModel.id)} className="text-xs text-slate-400 underline-offset-2 hover:text-red-300 hover:underline">
                  Delete to free {formatBytes(selectedModel.sizeBytes)}
                </button>
              )}
            </div>
          </div>
          {selectedEval.lowAvailable && selectedEval.canRun && (
            <p className="mt-2 text-xs text-amber-300/90">Your free memory is below this model's footprint — close some apps before running.</p>
          )}
          {selectedEval.slowOnCpu && selectedEval.canRun && (
            <p className="mt-2 text-xs text-amber-300/90">No GPU detected — this model runs on the CPU and can be slow.</p>
          )}
          {selectedModel.error && <p className="mt-2 text-xs text-red-300">{selectedModel.error}</p>}
        </div>
      )}

      {/* Two-pane editor: input left, summary right */}
      <form className="mt-6" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className={`${labelClass} mb-0`}>Your text</label>
              <span className="text-xs text-slate-500">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isProcessing}
              rows={16}
              placeholder="Paste or type the text you want summarized…"
              className={`${inputClass} resize-y leading-relaxed`}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className={`${labelClass} mb-0`}>Summary</label>
              <div className="flex items-center gap-2">
                {usedProvider && (
                  <span className={`rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold ${usedProvider === 'cuda' ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' : 'border-slate-400/40 bg-slate-500/15 text-slate-200'}`}>
                    Ran on {providerLabel(usedProvider)}
                  </span>
                )}
                {summary && (
                  <button type="button" onClick={handleCopy} className="text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline">
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                )}
              </div>
            </div>
            <div className="h-[calc(100%-1.75rem)] min-h-[16rem] overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm leading-relaxed text-slate-100">
              {isProcessing ? (
                <span className="text-slate-400">Summarizing…</span>
              ) : summary ? (
                summary
              ) : (
                <span className="text-slate-500">The summary will appear here.</span>
              )}
            </div>
          </div>
        </div>

        {errorMessage && (
          <div className="mt-4 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-5 w-full rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {isProcessing
            ? 'Summarizing…'
            : !data.engineAvailable
              ? 'AI engine not available in this build'
              : !selectedModel
                ? 'Select a model first'
                : !selectedModel.downloaded
                  ? 'Download the model first'
                  : !selectedEval?.canRun
                    ? 'Your machine can’t run this model'
                    : !trimmed
                      ? 'Enter some text to summarize'
                      : `Summarize with ${selectedModel.name}`}
        </button>
      </form>
    </div>
  )
}

export default SummarizeView
