package features

import (
	"image"
	"net/http"
)

// HandleEnhanceImage cleans up noisy images. The pipeline runs in a fixed
// order: denoise -> auto contrast -> sharpen, with defaults tuned so a request
// with no parameters performs a sensible one-click enhancement.
//
// Form fields (all optional):
//
//	denoise      - 0-100 strength of the edge-preserving smoothing (default 30)
//	autoContrast - "0" to skip the histogram stretch (default on)
//	sharpen      - 0-100 unsharp-mask strength (default 40)
//	format       - output format ("keep" reuses the source format)
//	quality      - JPEG quality 1-100
//
// Accepts one image or many (batch); several inputs come back as a ZIP.
func HandleEnhanceImage(w http.ResponseWriter, r *http.Request) {
	headers, ok := receiveImages(w, r)
	if !ok {
		return
	}

	denoise := clampRange(formFloat(r, "denoise", 30), 0, 100)
	sharpenAmt := clampRange(formFloat(r, "sharpen", 40), 0, 100)
	autoContrast := r.FormValue("autoContrast") != "0" && r.FormValue("autoContrast") != "false"

	if denoise == 0 && sharpenAmt == 0 && !autoContrast {
		http.Error(w, "Enable at least one of denoise, auto contrast or sharpen.", http.StatusBadRequest)
		return
	}

	requestedFormat := r.FormValue("format")
	quality := formInt(r, "quality", 90)

	transform := func(img image.Image, srcFormat, _ string) (image.Image, string, error) {
		out := toNRGBA(img)
		if denoise > 0 {
			// Strength maps to a larger blur radius and a higher edge threshold.
			radius := 1 + int(denoise/40)               // 1..3
			threshold := 12 + denoise*0.28              // 12..40
			out = selectiveBlur(out, radius, threshold) // edge-preserving smoothing
		}
		if autoContrast {
			out = stretchContrast(out, 0.005)
		}
		if sharpenAmt > 0 {
			out = sharpen(out, sharpenAmt/100)
		}
		return out, normalizeOutputFormat(requestedFormat, srcFormat), nil
	}

	serveProcessedImages(w, headers, transform, "enhanced", quality)
}

// selectiveBlur is an O(n) edge-preserving denoiser ("surface blur"): each
// pixel takes the box-blurred value only when it is within threshold of the
// original, so flat noisy areas smooth out while edges stay crisp.
func selectiveBlur(src *image.NRGBA, radius int, threshold float64) *image.NRGBA {
	blurred := boxBlurPass(boxBlurPass(src, radius, true), radius, false)
	out := image.NewNRGBA(src.Bounds())
	for i := 0; i < len(src.Pix); i += 4 {
		for c := 0; c < 3; c++ {
			orig := float64(src.Pix[i+c])
			soft := float64(blurred.Pix[i+c])
			diff := orig - soft
			if diff < 0 {
				diff = -diff
			}
			if diff <= threshold {
				out.Pix[i+c] = blurred.Pix[i+c]
			} else {
				out.Pix[i+c] = src.Pix[i+c]
			}
		}
		out.Pix[i+3] = src.Pix[i+3]
	}
	return out
}

// stretchContrast linearly remaps each channel so that the clip fraction of
// darkest and brightest luminance values hit pure black and white.
func stretchContrast(src *image.NRGBA, clip float64) *image.NRGBA {
	var hist [256]int
	total := 0
	for i := 0; i < len(src.Pix); i += 4 {
		if src.Pix[i+3] == 0 {
			continue
		}
		y := int(0.299*float64(src.Pix[i]) + 0.587*float64(src.Pix[i+1]) + 0.114*float64(src.Pix[i+2]) + 0.5)
		if y > 255 {
			y = 255
		}
		hist[y]++
		total++
	}
	if total == 0 {
		return src
	}

	clipCount := int(float64(total) * clip)
	lo, hi := 0, 255
	for count := 0; lo < 255; lo++ {
		count += hist[lo]
		if count > clipCount {
			break
		}
	}
	for count := 0; hi > 0; hi-- {
		count += hist[hi]
		if count > clipCount {
			break
		}
	}
	if hi <= lo {
		return src
	}

	scale := 255 / float64(hi-lo)
	return mapPixels(src, func(r, g, b uint8) (uint8, uint8, uint8) {
		return clampByte((float64(r) - float64(lo)) * scale),
			clampByte((float64(g) - float64(lo)) * scale),
			clampByte((float64(b) - float64(lo)) * scale)
	})
}
