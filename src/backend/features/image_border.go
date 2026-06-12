package features

import (
	"image"
	"image/color"
	"math"
	"net/http"

	"golang.org/x/image/draw"
)

// HandleImageBorder adds a solid border and/or rounded corners to an image.
// Because rounded corners require transparency, the output is always PNG.
//
// Form fields:
//
//	borderWidth  - border thickness in pixels (default 0)
//	borderColor  - hex color for the border, e.g. #ffffff (default white)
//	cornerRadius - corner radius in pixels applied to the outer rectangle (default 0)
//
// Accepts one image or many (batch); several inputs come back as a ZIP.
func HandleImageBorder(w http.ResponseWriter, r *http.Request) {
	headers, ok := receiveImages(w, r)
	if !ok {
		return
	}

	borderWidth := formInt(r, "borderWidth", 0)
	if borderWidth < 0 {
		borderWidth = 0
	}
	if borderWidth > maxImageDimension/2 {
		borderWidth = maxImageDimension / 2
	}
	borderColor := parseHexColor(r.FormValue("borderColor"), color.NRGBA{R: 255, G: 255, B: 255, A: 255})
	cornerRadius := formInt(r, "cornerRadius", 0)
	if cornerRadius < 0 {
		cornerRadius = 0
	}

	transform := func(img image.Image, _, _ string) (image.Image, string, error) {
		src := img.Bounds()
		outW := src.Dx() + 2*borderWidth
		outH := src.Dy() + 2*borderWidth
		out := image.NewRGBA(image.Rect(0, 0, outW, outH))

		// Fill with the border color, then draw the source image inset by the
		// border width. When borderWidth is 0 the fill is fully covered.
		draw.Draw(out, out.Bounds(), image.NewUniform(borderColor), image.Point{}, draw.Src)
		dstRect := image.Rect(borderWidth, borderWidth, borderWidth+src.Dx(), borderWidth+src.Dy())
		draw.Draw(out, dstRect, img, src.Min, draw.Over)

		if cornerRadius > 0 {
			applyRoundedMask(out, cornerRadius)
		}
		return out, "png", nil
	}

	serveProcessedImages(w, headers, transform, "framed", 100)
}

// applyRoundedMask multiplies each pixel's alpha by its coverage inside a
// rounded rectangle, producing anti-aliased corners. The radius is clamped to
// at most half of the smaller side.
func applyRoundedMask(img *image.RGBA, radius int) {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	maxR := w
	if h < maxR {
		maxR = h
	}
	if radius > maxR/2 {
		radius = maxR / 2
	}
	if radius <= 0 {
		return
	}

	rf := float64(radius)
	// Corner circle centers, expressed in pixel-center coordinates.
	centers := [4][2]float64{
		{rf - 0.5, rf - 0.5},                           // top-left
		{float64(w) - rf - 0.5, rf - 0.5},              // top-right
		{rf - 0.5, float64(h) - rf - 0.5},              // bottom-left
		{float64(w) - rf - 0.5, float64(h) - rf - 0.5}, // bottom-right
	}

	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			cov := cornerCoverage(float64(x), float64(y), radius, w, h, centers)
			if cov >= 1 {
				continue
			}
			idx := img.PixOffset(b.Min.X+x, b.Min.Y+y)
			if cov <= 0 {
				img.Pix[idx+3] = 0
				continue
			}
			a := float64(img.Pix[idx+3]) * cov
			img.Pix[idx+3] = uint8(a + 0.5)
		}
	}
}

// cornerCoverage returns 1 for pixels fully inside the rounded rectangle, 0 for
// fully outside, and a fractional value within ~1px of a corner arc for
// anti-aliasing. Pixels that aren't in any corner region are always covered.
func cornerCoverage(x, y float64, radius, w, h int, centers [4][2]float64) float64 {
	rf := float64(radius)
	inLeft := x < rf
	inRight := x > float64(w)-rf
	inTop := y < rf
	inBottom := y > float64(h)-rf

	var cx, cy float64
	switch {
	case inLeft && inTop:
		cx, cy = centers[0][0], centers[0][1]
	case inRight && inTop:
		cx, cy = centers[1][0], centers[1][1]
	case inLeft && inBottom:
		cx, cy = centers[2][0], centers[2][1]
	case inRight && inBottom:
		cx, cy = centers[3][0], centers[3][1]
	default:
		return 1 // edges and interior are fully covered
	}

	dist := math.Hypot(x-cx, y-cy)
	// Smooth a 1px band straddling the arc for anti-aliasing.
	return clamp01(rf + 0.5 - dist)
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
