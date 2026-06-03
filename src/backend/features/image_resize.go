package features

import (
	"local-tools-hub/backend/features/shared"
	"net/http"
	"strings"
)

// HandleResizeImage resizes an uploaded image. Supported modes:
//
//	fit      - scale to fit within width x height, preserving aspect ratio (default)
//	exact    - stretch to exactly width x height, ignoring aspect ratio
//	percent  - scale by a percentage of the original size
//
// Output format is configurable ("keep", png, jpeg, ...); quality applies to JPEG.
func HandleResizeImage(w http.ResponseWriter, r *http.Request) {
	img, srcFormat, name, ok := receiveSingleImage(w, r)
	if !ok {
		return
	}

	bounds := img.Bounds()
	srcW, srcH := bounds.Dx(), bounds.Dy()

	mode := strings.ToLower(strings.TrimSpace(r.FormValue("mode")))
	if mode == "" {
		mode = "fit"
	}

	var targetW, targetH int
	switch mode {
	case "percent":
		percent := formFloat(r, "percent", 100)
		if percent <= 0 {
			http.Error(w, "Percentage must be greater than zero.", http.StatusBadRequest)
			return
		}
		targetW = clampDim(int(float64(srcW)*percent/100 + 0.5))
		targetH = clampDim(int(float64(srcH)*percent/100 + 0.5))
	case "exact":
		targetW = formInt(r, "width", srcW)
		targetH = formInt(r, "height", srcH)
		if targetW <= 0 || targetH <= 0 {
			http.Error(w, "Width and height are required for exact resizing.", http.StatusBadRequest)
			return
		}
		targetW, targetH = clampDim(targetW), clampDim(targetH)
	default: // fit
		maxW := formInt(r, "width", 0)
		maxH := formInt(r, "height", 0)
		if maxW <= 0 && maxH <= 0 {
			http.Error(w, "Provide a width and/or height to resize to.", http.StatusBadRequest)
			return
		}
		targetW, targetH = fitDimensions(srcW, srcH, maxW, maxH)
	}

	resized := resizeImage(img, targetW, targetH)

	format := normalizeOutputFormat(r.FormValue("format"), srcFormat)
	quality := formInt(r, "quality", 90)
	writeImageResult(w, resized, format, quality, shared.SafeFileBase(name), "resized")
}
