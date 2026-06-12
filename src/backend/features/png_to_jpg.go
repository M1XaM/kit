package features

import (
	"fmt"
	"image"
	"net/http"
	"strings"
)

// HandlePngToJpg converts PNG uploads to JPEG. Accepts one image or many
// (batch); several inputs come back as a ZIP.
func HandlePngToJpg(w http.ResponseWriter, r *http.Request) {
	headers, ok := receiveImages(w, r)
	if !ok {
		return
	}

	quality := formInt(r, "quality", 90)

	transform := func(img image.Image, srcFormat, name string) (image.Image, string, error) {
		if srcFormat != "png" {
			return nil, "", fmt.Errorf("%q is not a PNG file", strings.TrimSpace(name))
		}
		return img, "jpeg", nil
	}

	serveProcessedImages(w, headers, transform, "converted", quality)
}
