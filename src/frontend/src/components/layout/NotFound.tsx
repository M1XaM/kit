import { useNavigate } from 'react-router-dom'

function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
      <h1 className="text-3xl font-semibold text-slate-50">404 - Page Not Found</h1>
      <p className="mt-4 text-sm text-slate-400">Oops! The page you're looking for doesn't exist.</p>
      <button
        className="mx-auto mt-8 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
        onClick={() => navigate('/')}
      >
        Return to Home
      </button>
    </div>
  )
}

export default NotFound
