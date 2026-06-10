package features

import (
	"local-tools-hub/backend/features/shared"
	"net/http"
	"strings"
)

// allowedImageTargets are the formats we can encode. WebP is accepted as input
// (decode-only in x/image) but cannot be a target.
var allowedImageTargets = map[string]bool{
	"png": true, "jpeg": true, "jpg": true, "gif": true, "bmp": true, "tiff": true, "tif": true,
}

// HandleConvertImage re-encodes an image into another format.
//
// Form fields:
//
//	format  - target format: png, jpeg, gif, bmp or tiff
//	quality - JPEG quality 1-100 (ignored for other formats)
func HandleConvertImage(w http.ResponseWriter, r *http.Request) {
	img, _, name, ok := receiveSingleImage(w, r)
	if !ok {
		return
	}

	target := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
	if !allowedImageTargets[target] {
		http.Error(w, "Unsupported target format. Choose png, jpeg, gif, bmp or tiff.", http.StatusBadRequest)
		return
	}

	format := normalizeOutputFormat(target, "")
	quality := formInt(r, "quality", 90)
	writeImageResult(w, img, format, quality, shared.SafeFileBase(name), "converted")
}
