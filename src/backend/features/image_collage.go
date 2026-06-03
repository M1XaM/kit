package features

import (
	"fmt"
	"image"
	"image/color"
	"math"
	"net/http"

	"golang.org/x/image/draw"
)

// HandleImageCollage arranges multiple uploaded images (form field "files",
// with "images"/"file" fallbacks) into a uniform grid. Each image is scaled to
// fit within a cell, preserving its aspect ratio, and centered.
//
// Form fields:
//
//	columns    - number of columns (default: ceil(sqrt(count)))
//	tileWidth  - cell width in pixels (default 320)
//	tileHeight - cell height in pixels (default 320)
//	spacing    - gap between cells in pixels (default 12)
//	background - hex background color (default white)
func HandleImageCollage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	headers := r.MultipartForm.File["files"]
	if len(headers) == 0 {
		headers = r.MultipartForm.File["images"]
	}
	if len(headers) == 0 {
		headers = r.MultipartForm.File["file"]
	}
	if len(headers) < 2 {
		http.Error(w, "Select at least two images to build a collage.", http.StatusBadRequest)
		return
	}

	images := make([]image.Image, 0, len(headers))
	for _, h := range headers {
		f, err := h.Open()
		if err != nil {
			http.Error(w, "Failed to read an uploaded image.", http.StatusBadRequest)
			return
		}
		decoded, _, err := image.Decode(f)
		f.Close()
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to decode %q. Supported: PNG, JPG, GIF, WebP, BMP, TIFF.", h.Filename), http.StatusBadRequest)
			return
		}
		images = append(images, decoded)
	}

	count := len(images)
	columns := formInt(r, "columns", 0)
	if columns <= 0 {
		columns = int(math.Ceil(math.Sqrt(float64(count))))
	}
	if columns > count {
		columns = count
	}
	rows := int(math.Ceil(float64(count) / float64(columns)))

	tileW := clampDim(formInt(r, "tileWidth", 320))
	tileH := clampDim(formInt(r, "tileHeight", 320))
	spacing := formInt(r, "spacing", 12)
	if spacing < 0 {
		spacing = 0
	}
	background := parseHexColor(r.FormValue("background"), color.NRGBA{R: 255, G: 255, B: 255, A: 255})

	canvasW := columns*tileW + (columns+1)*spacing
	canvasH := rows*tileH + (rows+1)*spacing
	if canvasW > maxImageDimension || canvasH > maxImageDimension {
		http.Error(w, "Resulting collage is too large. Reduce the tile size, spacing, or number of columns.", http.StatusBadRequest)
		return
	}

	canvas := image.NewRGBA(image.Rect(0, 0, canvasW, canvasH))
	draw.Draw(canvas, canvas.Bounds(), image.NewUniform(background), image.Point{}, draw.Src)

	for i, img := range images {
		col := i % columns
		row := i / columns
		cellX := spacing + col*(tileW+spacing)
		cellY := spacing + row*(tileH+spacing)

		// Scale the image to fit inside the tile, preserving aspect ratio.
		b := img.Bounds()
		fw, fh := fitDimensions(b.Dx(), b.Dy(), tileW, tileH)
		offX := cellX + (tileW-fw)/2
		offY := cellY + (tileH-fh)/2
		dstRect := image.Rect(offX, offY, offX+fw, offY+fh)
		draw.CatmullRom.Scale(canvas, dstRect, img, b, draw.Over, nil)
	}

	format := normalizeOutputFormat(r.FormValue("format"), "png")
	quality := formInt(r, "quality", 90)
	writeImageResult(w, canvas, format, quality, "collage", "grid")
}
