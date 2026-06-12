package features

import (
	"image"
	"net/http"
)

// HandleCompressImage re-encodes uploaded images to shrink their file size.
//
//   - format "jpeg" with a quality slider (1-100) gives lossy compression and
//     the biggest savings.
//   - format "png" (or keep, for PNG sources) re-encodes losslessly with the
//     best compression level.
//
// An optional maxWidth/maxHeight downscales the image first, which is usually
// the single most effective way to reduce size. Accepts one image or many
// (batch); several inputs come back as a ZIP.
func HandleCompressImage(w http.ResponseWriter, r *http.Request) {
	headers, ok := receiveImages(w, r)
	if !ok {
		return
	}

	maxW := formInt(r, "maxWidth", 0)
	maxH := formInt(r, "maxHeight", 0)

	// Default compression target is JPEG since it yields the largest savings;
	// callers can force PNG to stay lossless.
	requested := r.FormValue("format")
	if requested == "" {
		requested = "jpeg"
	}

	quality := formInt(r, "quality", 75)
	if quality < 1 {
		quality = 1
	}
	if quality > 100 {
		quality = 100
	}

	transform := func(img image.Image, srcFormat, _ string) (image.Image, string, error) {
		// Optional downscale before encoding. Only ever shrink — never
		// enlarge — when compressing.
		if maxW > 0 || maxH > 0 {
			bounds := img.Bounds()
			tw, th := fitDimensions(bounds.Dx(), bounds.Dy(), maxW, maxH)
			if tw < bounds.Dx() || th < bounds.Dy() {
				img = resizeImage(img, tw, th)
			}
		}
		return img, normalizeOutputFormat(requested, srcFormat), nil
	}

	serveProcessedImages(w, headers, transform, "compressed", quality)
}
