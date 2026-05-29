import { Link } from 'react-router-dom'
import RuntimePill from './RuntimePill'

function ComingSoon({ tool }) {
  const Icon = tool.icon
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-10 text-left backdrop-blur">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${tool.colorClass}`}>
          {Icon ? <Icon /> : null}
        </div>
        <span className="rounded-full border border-blue-400/50 bg-blue-600/30 px-2.5 py-1 text-xs font-semibold tracking-wide text-blue-200">Soon</span>
        <RuntimePill tool={tool} className="px-2.5 py-1 text-[0.6rem]" />
      </div>
      <h2 className="text-2xl font-semibold text-slate-50">{tool.title}</h2>
      <p className="mt-3 text-lg font-extrabold tracking-[0.14em] text-blue-200">COMING SOON</p>
      <p className="mt-4 text-sm leading-relaxed text-slate-400">{tool.description}</p>
      <p className="mt-4 text-sm text-slate-500">We are actively building this feature and will ship it as soon as possible.</p>
    </div>
  )
}

export default ComingSoon
