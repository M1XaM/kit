// ModelPicker is the shared card-based model selector used by every AI tool
// (Summarize, Paraphrase, Remove Background, OCR languages). Each model is a
// clickable card showing its tier, size and download state, replacing the old
// long-text <select> dropdowns.

export type PickerModel = {
  id: string
  name: string
  description?: string
  sizeBytes?: number
  tier?: 'light' | 'medium' | 'strong'
  downloaded: boolean
  downloading?: boolean
  progress?: number
  error?: string
  recommended?: boolean
  // Set when the machine can't run this model; shown instead of actions.
  disabledReason?: string
}

type ModelPickerProps = {
  models: PickerModel[]
  selectedId: string
  busy?: boolean
  onSelect: (id: string) => void
  onDownload: (id: string) => void
  // Omit to hide delete entirely (e.g. bundled models pass deletable=false per model).
  onDelete?: (id: string) => void
  deletableIds?: Set<string>
}

const TIER_BADGES: Record<string, { label: string; cls: string }> = {
  light: { label: 'Light', cls: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' },
  medium: { label: 'Medium', cls: 'border-amber-400/40 bg-amber-500/15 text-amber-200' },
  strong: { label: 'Strong', cls: 'border-rose-400/40 bg-rose-500/15 text-rose-200' }
}

const formatBytes = (value?: number) => {
  if (value == null || Number.isNaN(value)) return ''
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

function ModelPicker({ models, selectedId, busy, onSelect, onDownload, onDelete, deletableIds }: ModelPickerProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {models.map((model) => {
        const selected = model.id === selectedId
        const tier = model.tier ? TIER_BADGES[model.tier] : null
        const unusable = !!model.disabledReason
        const deletable = onDelete && model.downloaded && (!deletableIds || deletableIds.has(model.id))
        return (
          <button
            key={model.id}
            type="button"
            onClick={() => !unusable && onSelect(model.id)}
            disabled={busy}
            aria-pressed={selected}
            className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition ${
              selected
                ? 'border-blue-400/70 bg-blue-600/15 shadow-[0_0_0_1px_rgba(96,165,250,0.4)]'
                : unusable
                  ? 'border-white/5 bg-white/[0.02] opacity-60'
                  : 'border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-100">{model.name}</span>
              {tier && (
                <span className={`rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider ${tier.cls}`}>
                  {tier.label}
                </span>
              )}
              {model.recommended && (
                <span className="rounded-full bg-blue-500/90 px-2 py-0.5 text-[0.6rem] font-bold text-white">★ Recommended</span>
              )}
            </div>

            {model.description && (
              <p className="text-xs leading-relaxed text-slate-400">{model.description}</p>
            )}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-xs text-slate-500">{formatBytes(model.sizeBytes)}</span>

              {unusable ? (
                <span className="rounded-full border border-red-400/50 bg-red-900/30 px-2.5 py-0.5 text-[0.65rem] font-semibold text-red-200">
                  {model.disabledReason}
                </span>
              ) : model.downloaded ? (
                <span className="flex items-center gap-2">
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[0.65rem] font-semibold text-emerald-200">
                    ✓ Downloaded
                  </span>
                  {deletable && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="text-[0.65rem] text-slate-400 underline-offset-2 hover:text-red-300 hover:underline"
                      onClick={(e) => { e.stopPropagation(); onDelete?.(model.id) }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          onDelete?.(model.id)
                        }
                      }}
                    >
                      Delete
                    </span>
                  )}
                </span>
              ) : model.downloading ? (
                <span className="flex w-28 flex-col gap-1">
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                    <span className="block h-full rounded-full bg-blue-500 transition-all" style={{ width: `${model.progress || 0}%` }} />
                  </span>
                  <span className="text-right text-[0.65rem] text-slate-400">{Math.round(model.progress || 0)}%</span>
                </span>
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded-lg bg-emerald-600 px-3 py-1 text-[0.7rem] font-semibold text-white transition hover:bg-emerald-700"
                  onClick={(e) => { e.stopPropagation(); onDownload(model.id) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      onDownload(model.id)
                    }
                  }}
                >
                  Download ↓
                </span>
              )}
            </div>

            {model.error && <p className="text-[0.65rem] text-red-300">{model.error}</p>}
          </button>
        )
      })}
    </div>
  )
}

export default ModelPicker
