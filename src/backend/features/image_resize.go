package features

import (
	"image"
	"net/http"
	"strings"
)

// HandleResizeImage resizes uploaded images. Supported modes:
//
//	fit      - scale to fit within width x height, preserving aspect ratio (default)
//	exact    - stretch to exactly width x height, ignoring aspect ratio
//	percent  - scale by a percentage of the original size
//
// Output format is configurable ("keep", png, jpeg, ...); quality applies to
// JPEG. Accepts one image or many (batch); several inputs come back as a ZIP.
func HandleResizeImage(w http.ResponseWriter, r *http.Request) {
	headers, ok := receiveImages(w, r)
	if !ok {
		return
	}

	mode := strings.ToLower(strings.TrimSpace(r.FormValue("mode")))
	if mode == "" {
		mode = "fit"
	}

	percent := formFloat(r, "percent", 0)
	width := formInt(r, "width", 0)
	height := formInt(r, "height", 0)
	switch mode {
	case "percent":
		if percent <= 0 {
			http.Error(w, "Percentage must be greater than zero.", http.StatusBadRequest)
			return
		}
	case "exact":
		if width <= 0 || height <= 0 {
			http.Error(w, "Width and height are required for exact resizing.", http.StatusBadRequest)
			return
		}
	default: // fit
		if width <= 0 && height <= 0 {
			http.Error(w, "Provide a width and/or height to resize to.", http.StatusBadRequest)
			return
		}
	}

	requestedFormat := r.FormValue("format")
	quality := formInt(r, "quality", 90)

	transform := func(img image.Image, srcFormat, _ string) (image.Image, string, error) {
		bounds := img.Bounds()
		srcW, srcH := bounds.Dx(), bounds.Dy()
		var targetW, targetH int
		switch mode {
		case "percent":
			targetW = clampDim(int(float64(srcW)*percent/100 + 0.5))
			targetH = clampDim(int(float64(srcH)*percent/100 + 0.5))
		case "exact":
			targetW, targetH = clampDim(width), clampDim(height)
		default:
			targetW, targetH = fitDimensions(srcW, srcH, width, height)
		}
		return resizeImage(img, targetW, targetH), normalizeOutputFormat(requestedFormat, srcFormat), nil
	}

	serveProcessedImages(w, headers, transform, "resized", quality)
}
