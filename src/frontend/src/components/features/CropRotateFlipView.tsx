import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FeatureHeader from './FeatureHeader'
import type { Tool } from './toolData'

type CropRotateFlipViewProps = {
  tool: Tool
}

type Rect = { x: number; y: number; w: number; h: number }
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type DragMode = 'new' | 'move' | 'resize'
type DragState = { mode: DragMode; handle: Handle | null; origin: { x: number; y: number }; startRect: Rect }

const MAX_DISPLAY_WIDTH = 800
const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, '')
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

// Resize handles, positioned as fractions of the selection box. `cursor` is the
// matching CSS resize cursor.
const HANDLES: { id: Handle; fx: number; fy: number; cursor: string }[] = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' }
]

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
  const [canvasDims, setCanvasDims] = useState({ w: 0, h: 0 })
  const [selection, setSelection] = useState<Rect | null>(null)
  const dragRef = useRef<DragState | null>(null)
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
    setCanvasDims({ w: canvas.width, h: canvas.height })
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

  // Selection is tracked in canvas (display) pixels. canvasPoint maps a screen
  // coordinate into that space, clamped to the canvas bounds.
  const canvasPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: clamp(((clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
      y: clamp(((clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height)
    }
  }

  // clampRect keeps a selection inside the canvas.
  const clampRect = (rect: Rect): Rect => {
    const canvas = canvasRef.current
    const maxW = canvas?.width ?? rect.x + rect.w
    const maxH = canvas?.height ?? rect.y + rect.h
    const x = clamp(rect.x, 0, maxW)
    const y = clamp(rect.y, 0, maxH)
    return { x, y, w: clamp(rect.w, 0, maxW - x), h: clamp(rect.h, 0, maxH - y) }
  }

  // beginDrag starts a new selection, a move, or an edge/corner resize. The
  // gesture is then driven by window listeners (see the effect below) so the
  // pointer can leave the canvas mid-drag.
  const beginDrag = (mode: DragMode, handle: Handle | null, clientX: number, clientY: number) => {
    if (!loaded) return
    const origin = canvasPoint(clientX, clientY)
    const startRect = selection ?? { x: origin.x, y: origin.y, w: 0, h: 0 }
    dragRef.current = { mode, handle, origin, startRect }
    if (mode === 'new') setSelection({ x: origin.x, y: origin.y, w: 0, h: 0 })
  }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const pos = canvasPoint(event.clientX, event.clientY)
      const dx = pos.x - drag.origin.x
      const dy = pos.y - drag.origin.y
      if (drag.mode === 'new') {
        setSelection({
          x: Math.min(drag.origin.x, pos.x),
          y: Math.min(drag.origin.y, pos.y),
          w: Math.abs(pos.x - drag.origin.x),
          h: Math.abs(pos.y - drag.origin.y)
        })
      } else if (drag.mode === 'move') {
        const canvas = canvasRef.current
        const maxW = canvas?.width ?? 0
        const maxH = canvas?.height ?? 0
        setSelection({
          x: clamp(drag.startRect.x + dx, 0, maxW - drag.startRect.w),
          y: clamp(drag.startRect.y + dy, 0, maxH - drag.startRect.h),
          w: drag.startRect.w,
          h: drag.startRect.h
        })
      } else if (drag.handle) {
        const r = drag.startRect
        let left = r.x
        let right = r.x + r.w
        let top = r.y
        let bottom = r.y + r.h
        if (drag.handle.includes('w')) left = r.x + dx
        if (drag.handle.includes('e')) right = r.x + r.w + dx
        if (drag.handle.includes('n')) top = r.y + dy
        if (drag.handle.includes('s')) bottom = r.y + r.h + dy
        setSelection(
          clampRect({ x: Math.min(left, right), y: Math.min(top, bottom), w: Math.abs(right - left), h: Math.abs(bottom - top) })
        )
      }
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setSelection((sel) => (sel && (sel.w < 5 || sel.h < 5) ? null : sel))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  // Full-resolution dimensions of the (transformed) image, used to express the
  // selection as image pixels for the numeric fields.
  const fullSize = imgRef.current && loaded ? transformedSize(imgRef.current, rotation) : { w: 0, h: 0 }
  const fullSelection: Rect = selection
    ? {
        x: Math.round(selection.x / scale),
        y: Math.round(selection.y / scale),
        w: Math.round(selection.w / scale),
        h: Math.round(selection.h / scale)
      }
    : { x: 0, y: 0, w: fullSize.w, h: fullSize.h }

  // Update one px field and convert the full-resolution rect back to display px.
  const setFullField = (field: keyof Rect, value: number) => {
    if (!Number.isFinite(value)) return
    const next = { ...fullSelection, [field]: Math.max(0, Math.round(value)) }
    setSelection(clampRect({ x: next.x * scale, y: next.y * scale, w: next.w * scale, h: next.h * scale }))
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
        : 'border-white/15 bg-white/5 text-slate-200 hover:bg-white/10'
    }`

  return (
    <div className="mx-auto max-w-5xl rounded-2xl border p-10 text-left border-white/10 bg-white/5 backdrop-blur shadow-none">
      <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        Back to Tools
      </Link>

      <FeatureHeader tool={tool} subtitle="Crop, rotate and flip entirely in your browser — nothing is uploaded." />

      {errorMessage && (
        <div className="mt-5 rounded-xl border px-4 py-3 text-sm border-red-400/50 bg-red-900/25 text-red-200">{errorMessage}</div>
      )}

      {!loaded ? (
        <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition border-white/20 text-slate-400 hover:border-white/30 hover:bg-white/5">
          <svg className="mb-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <div className="text-sm text-slate-200">Click to choose an image</div>
          <input type="file" accept="image/*" onChange={(e) => loadFile(e.target.files)} className="hidden" />
        </label>
      ) : (
        <div className="mt-6 flex flex-col gap-5">
          <div className="relative inline-block self-center" style={{ lineHeight: 0 }}>
            <canvas
              ref={canvasRef}
              onPointerDown={(event) => beginDrag('new', null, event.clientX, event.clientY)}
              className="max-w-full cursor-crosshair touch-none rounded-lg border border-white/15"
            />
            {selection && selection.w > 0 && selection.h > 0 && canvasDims.w > 0 && (
              <div
                className="absolute cursor-move border-2 border-blue-500 bg-blue-400/20 touch-none"
                style={{
                  left: `${(selection.x / canvasDims.w) * 100}%`,
                  top: `${(selection.y / canvasDims.h) * 100}%`,
                  width: `${(selection.w / canvasDims.w) * 100}%`,
                  height: `${(selection.h / canvasDims.h) * 100}%`
                }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  beginDrag('move', null, event.clientX, event.clientY)
                }}
              >
                {HANDLES.map((handle) => (
                  <span
                    key={handle.id}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      beginDrag('resize', handle.id, event.clientX, event.clientY)
                    }}
                    style={{ left: `${handle.fx * 100}%`, top: `${handle.fy * 100}%`, cursor: handle.cursor }}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white bg-blue-500 shadow"
                  />
                ))}
              </div>
            )}
          </div>

          <p className="text-center text-xs text-slate-400">
            Drag on the image to draw a crop region, then drag its edges or corners to fine-tune. {selection ? 'Selection active.' : 'No selection — the full image is exported.'}
          </p>

          {/* Dragging is the primary way to crop; exact pixel entry stays
              tucked away in an optional section. */}
          <details className="rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3">
            <summary className="cursor-pointer select-none text-xs uppercase tracking-[0.12em] text-slate-400 hover:text-slate-200">
              Exact pixel values (optional)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                { field: 'x' as const, label: 'Left (px)' },
                { field: 'y' as const, label: 'Top (px)' },
                { field: 'w' as const, label: 'Width (px)' },
                { field: 'h' as const, label: 'Height (px)' }
              ]).map(({ field, label }) => (
                <div key={field}>
                  <label className="mb-1 block text-[0.7rem] uppercase tracking-[0.12em] text-slate-400">{label}</label>
                  <input
                    type="number"
                    min="0"
                    value={fullSelection[field]}
                    onChange={(e) => setFullField(field, Number(e.target.value))}
                    className="w-full rounded-lg border px-3 py-2 text-sm border-slate-800 bg-slate-900/70 text-white"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[0.7rem] text-slate-500">
              Image is {fullSize.w} × {fullSize.h}px. Type exact pixel values as an alternative to dragging.
            </p>
          </details>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className={toggleClass(false)} onClick={() => rotate(-90)}>⟲ Rotate left</button>
            <button type="button" className={toggleClass(false)} onClick={() => rotate(90)}>⟳ Rotate right</button>
            <button type="button" className={toggleClass(flipH)} onClick={() => setFlipH((v) => !v)}>⇆ Flip H</button>
            <button type="button" className={toggleClass(flipV)} onClick={() => setFlipV((v) => !v)}>⇅ Flip V</button>
            <button type="button" className={toggleClass(false)} onClick={() => setSelection(null)} disabled={!selection}>Clear crop</button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="cursor-pointer text-sm hover:underline text-blue-300">
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
