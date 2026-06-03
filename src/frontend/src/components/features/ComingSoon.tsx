import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'

function ComingSoon({ tool }) {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>
      <FeatureHeader
        tool={tool}
        subtitle="Currently in development. We're putting the finishing touches on it."
        rightSlot={(
          <span className="rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide border-blue-400/50 bg-blue-600/30 text-blue-200">Soon</span>
        )}
      />
      <p className="mt-3 text-lg font-extrabold tracking-[0.14em] text-blue-200">COMING SOON</p>
      <p className="mt-4 text-sm leading-relaxed text-slate-400">{tool.description}</p>
      <p className="mt-4 text-sm text-slate-500">We are actively building this feature and will ship it as soon as possible.</p>
    </div>
  )
}

export default ComingSoon
