import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

// YouTube Download: paste one or many YouTube links, pick what to download
// (video+audio, audio only, video only) and the quality. The backend runs
// yt-dlp locally; multiple videos come back as one ZIP.

const labelClass = 'mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white placeholder:text-slate-500'

const MODES = [
  { value: 'both', label: 'Video + audio' },
  { value: 'audio', label: 'Audio only (MP3)' },
  { value: 'video', label: 'Video only (no audio)' }
]

const QUALITIES = [
  { value: 'best', label: 'Best available' },
  { value: '2160', label: '4K (2160p)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' }
]

const MAX_LINKS = 10

const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'
])

const isYoutubeLink = (raw: string) => {
  try {
    const u = new URL(raw)
    return (u.protocol === 'https:' || u.protocol === 'http:') && YOUTUBE_HOSTS.has(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

type YoutubeDownloadViewProps = {
  tool: Tool
}

function YoutubeDownloadView({ tool }: YoutubeDownloadViewProps) {
  const [linksText, setLinksText] = useState('')
  const [mode, setMode] = useState('both')
  const [quality, setQuality] = useState('best')
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const links = useMemo(
    () => linksText.split('\n').map((line) => line.trim()).filter(Boolean),
    [linksText]
  )
  const invalidLinks = useMemo(() => links.filter((l) => !isYoutubeLink(l)), [links])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!links.length) {
      setErrorMessage('Paste at least one YouTube link.')
      return
    }
    if (links.length > MAX_LINKS) {
      setErrorMessage(`Too many links — the limit is ${MAX_LINKS} per download.`)
      return
    }
    if (invalidLinks.length) {
      setErrorMessage(`Not a YouTube link: ${invalidLinks[0]}`)
      return
    }

    setIsProcessing(true)
    setErrorMessage('')
    try {
      const res = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: links, mode, quality })
      })
      if (!res.ok) throw new Error((await res.text()) || res.statusText)

      let filename = links.length > 1 ? 'youtube_downloads.zip' : 'video'
      const disposition = res.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^";]+)"?/i)
      if (match) filename = match[1]

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Download failed.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle="Downloads run locally through yt-dlp, which ships bundled with Kit — nothing to install." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200 whitespace-pre-wrap">{errorMessage}</div>
      )}

      <form className="mt-6 flex flex-col gap-5" onSubmit={handleSubmit}>
        <div>
          <label className={labelClass}>YouTube links — one per line (up to {MAX_LINKS})</label>
          <textarea
            className={`${inputClass} min-h-[140px] font-mono`}
            value={linksText}
            onChange={(e) => setLinksText(e.target.value)}
            disabled={isProcessing}
            placeholder={'https://www.youtube.com/watch?v=...\nhttps://youtu.be/...'}
            spellCheck={false}
          />
          {links.length > 0 && (
            <p className={`mt-1 text-xs ${invalidLinks.length ? 'text-amber-300' : 'text-slate-500'}`}>
              {invalidLinks.length
                ? `${invalidLinks.length} of ${links.length} links don't look like YouTube links.`
                : `${links.length} link${links.length === 1 ? '' : 's'} ready.`}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Download</label>
            <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value)} disabled={isProcessing}>
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          {mode !== 'audio' && (
            <div>
              <label className={labelClass}>Quality</label>
              <select className={inputClass} value={quality} onChange={(e) => setQuality(e.target.value)} disabled={isProcessing}>
                {QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Several links download as one ZIP. Merging video + audio (and MP3 extraction) uses ffmpeg when installed.
          Best/1080p and below come out as H.264 MP4 that plays anywhere; 1440p/4K exist only as VP9/AV1 on YouTube, so they're saved as MKV.
          Only download content you have the right to save.
        </p>

        <button
          className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          type="submit"
          disabled={isProcessing || !links.length || invalidLinks.length > 0}
        >
          {isProcessing
            ? 'Downloading… this can take a while'
            : links.length > 1
              ? `Download ${links.length} videos → ZIP`
              : 'Download'}
        </button>
      </form>
    </div>
  )
}

export default YoutubeDownloadView
