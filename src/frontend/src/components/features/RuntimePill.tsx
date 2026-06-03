import type { Tool } from './toolData'

type RuntimePillProps = {
  tool?: Tool
  className?: string
}

function RuntimePill({ tool, className = '' }: RuntimePillProps) {
  const runtime = tool?.runtime || (tool?.apiEndpoint ? 'server' : 'client')
  const isClient = runtime === 'client'
  const label = isClient ? 'Client-side' : 'Server-side'
  const styleClass = isClient
    ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-200'
    : 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/15 dark:text-sky-200'

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] ${styleClass} ${className}`}>
      {label}
    </span>
  )
}

export default RuntimePill
