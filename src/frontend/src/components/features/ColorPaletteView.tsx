import { useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type ColorPaletteViewProps = {
  tool: Tool
}

type Swatch = { hex: string; rgb: [number, number, number] }

const SAMPLE_MAX = 200 // downscale longest edge to this many pixels before sampling

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

// medianCut quantizes the sampled pixels into `count` representative colors.
function medianCut(pixels: number[][], count: number): Swatch[] {
  if (!pixels.length) return []
  let buckets: number[][][] = [pixels]

  const longestChannel = (bucket: number[][]) => {
    const min = [255, 255, 255]
    const max = [0, 0, 0]
    for (const p of bucket) {
      for (let c = 0; c < 3; c++) {
        if (p[c] < min[c]) min[c] = p[c]
        if (p[c] > max[c]) max[c] = p[c]
      }
    }
    const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const channel = ranges.indexOf(Math.max(...ranges))
    return { channel, range: ranges[channel] }
  }

  while (buckets.length < count) {
    // Split the bucket with the widest color range.
    let targetIdx = -1
    let widest = -1
    buckets.forEach((bucket, i) => {
      if (bucket.length < 2) return
      const { range } = longestChannel(bucket)
      if (range > widest) {
        widest = range
        targetIdx = i
      }
    })
    if (targetIdx === -1) break

    const bucket = buckets[targetIdx]
    const { channel } = longestChannel(bucket)
    bucket.sort((a, b) => a[channel] - b[channel])
    const mid = Math.floor(bucket.length / 2)
    buckets.splice(targetIdx, 1, bucket.slice(0, mid), bucket.slice(mid))
  }

  return buckets
    .filter((b) => b.length)
    .map((bucket) => {
      const sum = [0, 0, 0]
      for (const p of bucket) {
        sum[0] += p[0]
        sum[1] += p[1]
        sum[2] += p[2]
      }
      const rgb: [number, number, number] = [
        Math.round(sum[0] / bucket.length),
        Math.round(sum[1] / bucket.length),
        Math.round(sum[2] / bucket.length)
      ]
      return { hex: toHex(rgb[0], rgb[1], rgb[2]), rgb }
    })
    // Sort light → dark for a tidy strip.
    .sort((a, b) => b.rgb[0] + b.rgb[1] + b.rgb[2] - (a.rgb[0] + a.rgb[1] + a.rgb[2]))
}

function ColorPaletteView({ tool }: ColorPaletteViewProps) {
  const [previewUrl, setPreviewUrl] = useState('')
  const [colorCount, setColorCount] = useState(6)
  const [palette, setPalette] = useState<Swatch[]>([])
  const [copied, setCopied] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [fileName, setFileName] = useState('')

  const extract = (file: File, count: number) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(SAMPLE_MAX / img.naturalWidth, SAMPLE_MAX / img.naturalHeight, 1)
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setErrorMessage('Canvas is not available in this browser.')
        URL.revokeObjectURL(url)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)
      const pixels: number[][] = []
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 125) continue // skip mostly-transparent pixels
        pixels.push([data[i], data[i + 1], data[i + 2]])
      }
      setPalette(medianCut(pixels, count))
      setPreviewUrl(URL.createObjectURL(file))
      setErrorMessage('')
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      setErrorMessage('Could not load that image.')
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  const [lastFile, setLastFile] = useState<File | null>(null)

  const onPick = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setFileName(file.name)
    setLastFile(file)
    extract(file, colorCount)
  }

  const onCountChange = (value: number) => {
    setColorCount(value)
    if (lastFile) extract(lastFile, value)
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(''), 1200)
    } catch {
      setErrorMessage('Clipboard access was blocked by the browser.')
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

      <FeatureHeader tool={tool} subtitle="Extract a dominant color palette in your browser — no upload needed." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition border-white/20 text-slate-400 hover:border-white/30 hover:bg-white/5">
        <div className="text-sm text-slate-200">{fileName || 'Click to choose an image'}</div>
        <div className="mt-1 text-xs text-slate-400">PNG, JPG, GIF, WebP…</div>
        <input type="file" accept="image/*" onChange={(e) => onPick(e.target.files)} className="hidden" />
      </label>

      {previewUrl && (
        <div className="mt-6 flex flex-col gap-5">
          <img src={previewUrl} alt="Selected" className="mx-auto max-h-56 rounded-lg border object-contain border-white/15" />

          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-[0.12em] text-slate-400">Colors: {colorCount}</label>
            <input
              type="range"
              min="3"
              max="12"
              value={colorCount}
              onChange={(e) => onCountChange(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-white/15">
            <div className="flex h-16">
              {palette.map((swatch) => (
                <div key={swatch.hex} className="flex-1" style={{ backgroundColor: swatch.hex }} title={swatch.hex} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {palette.map((swatch) => (
              <button
                key={swatch.hex}
                type="button"
                onClick={() => copy(swatch.hex)}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition border-white/15 bg-white/5 hover:bg-white/10"
              >
                <span className="h-6 w-6 shrink-0 rounded border border-black/10" style={{ backgroundColor: swatch.hex }} />
                <span className="font-mono text-slate-200">{copied === swatch.hex ? 'Copied!' : swatch.hex}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => copy(palette.map((s) => s.hex).join(', '))}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Copy all hex codes
          </button>
        </div>
      )}
    </div>
  )
}

export default ColorPaletteView
