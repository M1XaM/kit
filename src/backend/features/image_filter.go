package features

import (
	"image"
	"net/http"
	"strings"

	"golang.org/x/image/draw"
)

// HandleImageFilter applies a single pixel filter or effect to an image.
//
// Form fields:
//
//	filter - one of: grayscale, sepia, invert, brightness, contrast,
//	         saturate, blur, sharpen
//	amount - effect strength. Meaning depends on the filter:
//	           brightness/contrast/saturate: -100..100 (0 = no change)
//	           blur:    radius in pixels (1..50)
//	           sharpen: strength 0..100
//	         Ignored by grayscale/sepia/invert.
//
// Accepts one image or many (batch); several inputs come back as a ZIP.
func HandleImageFilter(w http.ResponseWriter, r *http.Request) {
	headers, ok := receiveImages(w, r)
	if !ok {
		return
	}

	filter := strings.ToLower(strings.TrimSpace(r.FormValue("filter")))
	amount := formFloat(r, "amount", 0)

	// applyFilter is resolved up front so an unknown filter fails before any
	// image is decoded.
	var applyFilter func(src *image.NRGBA) *image.NRGBA
	switch filter {
	case "grayscale", "greyscale":
		applyFilter = func(src *image.NRGBA) *image.NRGBA { return mapPixels(src, grayscalePixel) }
	case "sepia":
		applyFilter = func(src *image.NRGBA) *image.NRGBA { return mapPixels(src, sepiaPixel) }
	case "invert":
		applyFilter = func(src *image.NRGBA) *image.NRGBA { return mapPixels(src, invertPixel) }
	case "brightness":
		factor := 1 + clampRange(amount, -100, 100)/100
		applyFilter = func(src *image.NRGBA) *image.NRGBA {
			return mapPixels(src, func(r, g, b uint8) (uint8, uint8, uint8) {
				return clampByte(float64(r) * factor), clampByte(float64(g) * factor), clampByte(float64(b) * factor)
			})
		}
	case "contrast":
		c := clampRange(amount, -100, 100) * 2.55 // map to -255..255
		factor := (259 * (c + 255)) / (255 * (259 - c))
		applyFilter = func(src *image.NRGBA) *image.NRGBA {
			return mapPixels(src, func(r, g, b uint8) (uint8, uint8, uint8) {
				return clampByte(factor*(float64(r)-128) + 128),
					clampByte(factor*(float64(g)-128) + 128),
					clampByte(factor*(float64(b)-128) + 128)
			})
		}
	case "saturate", "saturation":
		factor := 1 + clampRange(amount, -100, 100)/100
		applyFilter = func(src *image.NRGBA) *image.NRGBA {
			return mapPixels(src, func(r, g, b uint8) (uint8, uint8, uint8) {
				lum := 0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b)
				return clampByte(lum + (float64(r)-lum)*factor),
					clampByte(lum + (float64(g)-lum)*factor),
					clampByte(lum + (float64(b)-lum)*factor)
			})
		}
	case "blur":
		radius := int(clampRange(amount, 1, 50) + 0.5)
		if radius < 1 {
			radius = 3
		}
		applyFilter = func(src *image.NRGBA) *image.NRGBA { return boxBlur(src, radius) }
	case "sharpen":
		strength := clampRange(amount, 0, 100) / 100
		if strength == 0 {
			strength = 0.6
		}
		applyFilter = func(src *image.NRGBA) *image.NRGBA { return sharpen(src, strength) }
	default:
		http.Error(w, "Unknown filter. Use grayscale, sepia, invert, brightness, contrast, saturate, blur or sharpen.", http.StatusBadRequest)
		return
	}

	requestedFormat := r.FormValue("format")
	quality := formInt(r, "quality", 90)

	transform := func(img image.Image, srcFormat, _ string) (image.Image, string, error) {
		return applyFilter(toNRGBA(img)), normalizeOutputFormat(requestedFormat, srcFormat), nil
	}

	serveProcessedImages(w, headers, transform, "filtered", quality)
}

// toNRGBA returns src as a non-premultiplied *image.NRGBA so per-channel math
// behaves intuitively even for images with transparency.
func toNRGBA(src image.Image) *image.NRGBA {
	if n, ok := src.(*image.NRGBA); ok {
		return n
	}
	b := src.Bounds()
	out := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(out, out.Bounds(), src, b.Min, draw.Src)
	return out
}

// mapPixels applies fn to every pixel's RGB channels, leaving alpha untouched.
func mapPixels(src *image.NRGBA, fn func(r, g, b uint8) (uint8, uint8, uint8)) *image.NRGBA {
	b := src.Bounds()
	out := image.NewNRGBA(b)
	for i := 0; i < len(src.Pix); i += 4 {
		r, g, bl := fn(src.Pix[i], src.Pix[i+1], src.Pix[i+2])
		out.Pix[i] = r
		out.Pix[i+1] = g
		out.Pix[i+2] = bl
		out.Pix[i+3] = src.Pix[i+3]
	}
	return out
}

func grayscalePixel(r, g, b uint8) (uint8, uint8, uint8) {
	y := clampByte(0.299*float64(r) + 0.587*float64(g) + 0.114*float64(b))
	return y, y, y
}

func sepiaPixel(r, g, b uint8) (uint8, uint8, uint8) {
	fr, fg, fb := float64(r), float64(g), float64(b)
	return clampByte(0.393*fr + 0.769*fg + 0.189*fb),
		clampByte(0.349*fr + 0.686*fg + 0.168*fb),
		clampByte(0.272*fr + 0.534*fg + 0.131*fb)
}

func invertPixel(r, g, b uint8) (uint8, uint8, uint8) {
	return 255 - r, 255 - g, 255 - b
}

// boxBlur applies a separable box blur of the given radius twice, which closely
// approximates a Gaussian blur while staying O(n) per pass.
func boxBlur(src *image.NRGBA, radius int) *image.NRGBA {
	tmp := boxBlurPass(src, radius, true)
	tmp = boxBlurPass(tmp, radius, false)
	tmp = boxBlurPass(tmp, radius, true)
	tmp = boxBlurPass(tmp, radius, false)
	return tmp
}

// boxBlurPass blurs along one axis. horizontal=true blurs rows, false blurs
// columns. Fully transparent pixels are skipped in the average via alpha
// weighting so transparent regions don't darken edges.
func boxBlurPass(src *image.NRGBA, radius int, horizontal bool) *image.NRGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	out := image.NewNRGBA(b)

	outer, inner := h, w
	if !horizontal {
		outer, inner = w, h
	}

	for o := 0; o < outer; o++ {
		for i := 0; i < inner; i++ {
			var rs, gs, bs, as, count float64
			for k := -radius; k <= radius; k++ {
				j := i + k
				if j < 0 || j >= inner {
					continue
				}
				var px, py int
				if horizontal {
					px, py = j, o
				} else {
					px, py = o, j
				}
				idx := src.PixOffset(b.Min.X+px, b.Min.Y+py)
				rs += float64(src.Pix[idx])
				gs += float64(src.Pix[idx+1])
				bs += float64(src.Pix[idx+2])
				as += float64(src.Pix[idx+3])
				count++
			}
			var px, py int
			if horizontal {
				px, py = i, o
			} else {
				px, py = o, i
			}
			idx := out.PixOffset(b.Min.X+px, b.Min.Y+py)
			out.Pix[idx] = uint8(rs/count + 0.5)
			out.Pix[idx+1] = uint8(gs/count + 0.5)
			out.Pix[idx+2] = uint8(bs/count + 0.5)
			out.Pix[idx+3] = uint8(as/count + 0.5)
		}
	}
	return out
}

// sharpen applies an unsharp mask: original + strength * (original - blurred).
func sharpen(src *image.NRGBA, strength float64) *image.NRGBA {
	blurred := boxBlurPass(boxBlurPass(src, 1, true), 1, false)
	b := src.Bounds()
	out := image.NewNRGBA(b)
	for i := 0; i < len(src.Pix); i += 4 {
		for c := 0; c < 3; c++ {
			orig := float64(src.Pix[i+c])
			diff := orig - float64(blurred.Pix[i+c])
			out.Pix[i+c] = clampByte(orig + strength*diff)
		}
		out.Pix[i+3] = src.Pix[i+3]
	}
	return out
}

func clampByte(v float64) uint8 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return uint8(v + 0.5)
}

func clampRange(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
