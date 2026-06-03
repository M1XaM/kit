import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type CropRotateFlipViewProps = {
  tool: Tool
}

type Rect = { x: number; y: number; w: number; h: number }

const MAX_DISPLAY_WIDTH = 520
const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')

// transformedSize returns the dimensions of the image after applying rotation
// (90/270 swap width and height).
const transformedSize = (img: HTMLImageElement, rotation: number) =>
  rotation % 180 === 0
    ? { w: img.naturalWidth, h: img.naturalHeight }
    : { w: img.naturalHeight, h: img.naturalWidth }

// drawTransformed paints img into ctx with the given rotation/flip, scaled by
// `scale`. The destination canvas is assumed to be (tw*scale) x (th*scale).
function drawTransformed(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
  tw: number,
  th: number,
  scale: number
) {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(tw / 2, th / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  ctx.restore()
}

function CropRotateFlipView({ tool }: CropRotateFlipViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [fileName, setFileName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [scale, setScale] = useState(1)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  // Redraw the preview canvas whenever the image or any transform changes.
  const redraw = useCallback(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    const { w: tw, h: th } = transformedSize(img, rotation)
    const nextScale = Math.min(MAX_DISPLAY_WIDTH / tw, 1)
    setScale(nextScale)
    canvas.width = Math.round(tw * nextScale)
    canvas.height = Math.round(th * nextScale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawTransformed(ctx, img, rotation, flipH, flipV, tw, th, nextScale)
  }, [rotation, flipH, flipV])

  useEffect(() => {
    if (loaded) redraw()
  }, [loaded, redraw])

  const loadFile = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setFileName(file.name)
      setRotation(0)
      setFlipH(false)
      setFlipV(false)
      setSelection(null)
      setLoaded(true)
      setErrorMessage('')
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      setErrorMessage('Could not load that image.')
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  // Selection is tracked in canvas (display) pixels.
  const pointerPos = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (event.target as HTMLCanvasElement).getBoundingClientRect()
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width))
    const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height))
    return { x, y }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const pos = pointerPos(event)
    setDragStart(pos)
    setSelection({ x: pos.x, y: pos.y, w: 0, h: 0 })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragStart) return
    const pos = pointerPos(event)
    setSelection({
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y)
    })
  }

  const onPointerUp = () => {
    setDragStart(null)
    setSelection((sel) => (sel && (sel.w < 5 || sel.h < 5) ? null : sel))
  }

  const rotate = (delta: number) => {
    setSelection(null)
    setRotation((prev) => (prev + delta + 360) % 360)
  }

  const exportImage = () => {
    const img = imgRef.current
    if (!img) return

    const { w: tw, h: th } = transformedSize(img, rotation)
    // Full-resolution transformed canvas.
    const full = document.createElement('canvas')
    full.width = tw
    full.height = th
    const fctx = full.getContext('2d')
    if (!fctx) return
    drawTransformed(fctx, img, rotation, flipH, flipV, tw, th, 1)

    // Map the display-space selection back to full-resolution pixels.
    let sx = 0
    let sy = 0
    let sw = tw
    let sh = th
    if (selection && selection.w > 0 && selection.h > 0) {
      sx = Math.round(selection.x / scale)
      sy = Math.round(selection.y / scale)
      sw = Math.round(selection.w / scale)
      sh = Math.round(selection.h / scale)
      sx = Math.max(0, Math.min(sx, tw - 1))
      sy = Math.max(0, Math.min(sy, th - 1))
      sw = Math.max(1, Math.min(sw, tw - sx))
      sh = Math.max(1, Math.min(sh, th - sy))
    }

    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    const octx = out.getContext('2d')
    if (!octx) return
    octx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh)

    out.toBlob((blob) => {
      if (!blob) {
        setErrorMessage('Failed to export the image.')
        return
      }
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${stripExtension(fileName || 'image')}_edited.png`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  const toggleClass = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-sm font-semibold transition ${
      active
        ? 'border-blue-500 bg-blue-600 text-white'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10'
    }`

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border p-10 text-left border-slate-300 bg-white shadow-md dark:border-white/10 dark:bg-white/5 dark:backdrop-blur dark:shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle="Crop, rotate and flip entirely in your browser — nothing is uploaded." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-200 bg-red-50 text-red-700 dark:border-red-400/50 dark:bg-red-900/25 dark:text-red-200">{errorMessage}</div>
      )}

      {!loaded ? (
        <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-10 text-center text-slate-500 transition hover:border-slate-400 hover:bg-slate-50 dark:border-white/20 dark:text-slate-400 dark:hover:border-white/30 dark:hover:bg-white/5">
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <div className="text-sm text-slate-700 dark:text-slate-200">Click to choose an image</div>
          <input type="file" accept="image/*" onChange={(e) => loadFile(e.target.files)} className="hidden" />
        </label>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          <div className="relative inline-block self-center" style={{ lineHeight: 0 }}>
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="max-w-full cursor-crosshair touch-none rounded-lg border border-slate-300 dark:border-white/15"
            />
            {selection && selection.w > 0 && selection.h > 0 && (
              <div
                className="pointer-events-none absolute border-2 border-blue-500 bg-blue-400/20"
                style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
              />
            )}
          </div>

          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Drag on the image to select a crop region. {selection ? 'Selection active.' : 'No selection — the full image is exported.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className={toggleClass(false)} onClick={() => rotate(-90)}>⟲ Rotate left</button>
            <button type="button" className={toggleClass(false)} onClick={() => rotate(90)}>⟳ Rotate right</button>
            <button type="button" className={toggleClass(flipH)} onClick={() => setFlipH((v) => !v)}>⇆ Flip H</button>
            <button type="button" className={toggleClass(flipV)} onClick={() => setFlipV((v) => !v)}>⇅ Flip V</button>
            <button type="button" className={toggleClass(false)} onClick={() => setSelection(null)} disabled={!selection}>Clear crop</button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="cursor-pointer text-sm text-blue-600 hover:underline dark:text-blue-300">
              Choose a different image
              <input type="file" accept="image/*" onChange={(e) => loadFile(e.target.files)} className="hidden" />
            </label>
            <button
              type="button"
              onClick={exportImage}
              className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Export PNG
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CropRotateFlipView
