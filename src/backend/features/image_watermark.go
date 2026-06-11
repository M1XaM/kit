package features

import (
	"image"
	"image/color"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"strings"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// HandleImageWatermark stamps a text or image watermark onto an image.
//
// Form fields:
//
//	type      - "text" (default) or "image"
//	text      - watermark text (type=text)
//	watermark - watermark image file (type=image)
//	position  - top-left, top-right, bottom-left, bottom-right (default),
//	            center or tile
//	opacity   - 0-100 (default 50)
//	margin    - distance from the edges in px (default 24)
//	fontSize  - text height in px (type=text, default 5% of image width)
//	color     - text color as hex (type=text, default #ffffff)
//	scale     - watermark width as % of the base image width (type=image,
//	            default 25)
//	format    - output format ("keep" reuses the source format)
//	quality   - JPEG quality 1-100
func HandleImageWatermark(w http.ResponseWriter, r *http.Request) {
	img, srcFormat, name, ok := receiveSingleImage(w, r)
	if !ok {
		return
	}

	base := toNRGBA(img)
	bounds := base.Bounds()

	opacity := clampRange(formFloat(r, "opacity", 50), 0, 100) / 100
	margin := formInt(r, "margin", 24)
	if margin < 0 {
		margin = 0
	}
	position := strings.ToLower(strings.TrimSpace(r.FormValue("position")))
	if position == "" {
		position = "bottom-right"
	}

	// Build the watermark stamp as a standalone NRGBA layer with opacity
	// already applied, then place it according to the requested position.
	var stamp *image.NRGBA
	switch strings.ToLower(strings.TrimSpace(r.FormValue("type"))) {
	case "image":
		wmFile, _, err := r.FormFile("watermark")
		if err != nil {
			http.Error(w, "A watermark image is required.", http.StatusBadRequest)
			return
		}
		defer wmFile.Close()
		wmImg, _, err := safeDecodeImage(wmFile)
		if err != nil {
			http.Error(w, "Failed to decode the watermark image.", http.StatusBadRequest)
			return
		}

		scalePct := clampRange(formFloat(r, "scale", 25), 1, 100)
		targetW := int(float64(bounds.Dx()) * scalePct / 100)
		if targetW < 1 {
			targetW = 1
		}
		wmBounds := wmImg.Bounds()
		targetH := int(float64(targetW) * float64(wmBounds.Dy()) / float64(wmBounds.Dx()))
		if targetH < 1 {
			targetH = 1
		}
		stamp = fadeAlpha(toNRGBA(resizeImage(wmImg, targetW, targetH)), opacity)
	default:
		text := strings.TrimSpace(r.FormValue("text"))
		if text == "" {
			http.Error(w, "Watermark text is required.", http.StatusBadRequest)
			return
		}
		fontSize := formInt(r, "fontSize", bounds.Dx()/20)
		if fontSize < 8 {
			fontSize = 8
		}
		if fontSize > 512 {
			fontSize = 512
		}
		col := parseHexColor(r.FormValue("color"), color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		col.A = uint8(float64(col.A)*opacity + 0.5)

		rendered, err := renderText(text, fontSize, col)
		if err != nil {
			http.Error(w, "Failed to render the watermark text.", http.StatusInternalServerError)
			return
		}
		stamp = rendered
	}

	out := image.NewNRGBA(bounds)
	draw.Draw(out, bounds, base, bounds.Min, draw.Src)
	placeStamp(out, stamp, position, margin)

	format := normalizeOutputFormat(r.FormValue("format"), srcFormat)
	quality := formInt(r, "quality", 90)
	writeImageResult(w, out, format, quality, shared.SafeFileBase(name), "watermarked")
}

// renderText draws text into a tightly sized transparent layer using the
// bundled Go Regular font, so no system fonts are required.
func renderText(text string, sizePx int, col color.NRGBA) (*image.NRGBA, error) {
	parsed, err := opentype.Parse(goregular.TTF)
	if err != nil {
		return nil, err
	}
	face, err := opentype.NewFace(parsed, &opentype.FaceOptions{
		Size:    float64(sizePx),
		DPI:     72,
		Hinting: font.HintingFull,
	})
	if err != nil {
		return nil, err
	}
	defer face.Close()

	metrics := face.Metrics()
	width := font.MeasureString(face, text).Ceil()
	height := (metrics.Ascent + metrics.Descent).Ceil()
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}

	layer := image.NewNRGBA(image.Rect(0, 0, width, height))
	drawer := &font.Drawer{
		Dst:  layer,
		Src:  image.NewUniform(col),
		Face: face,
		Dot:  fixed.Point26_6{X: 0, Y: metrics.Ascent},
	}
	drawer.DrawString(text)
	return layer, nil
}

// fadeAlpha returns a copy of src with every alpha value multiplied by factor.
func fadeAlpha(src *image.NRGBA, factor float64) *image.NRGBA {
	out := image.NewNRGBA(src.Bounds())
	copy(out.Pix, src.Pix)
	for i := 3; i < len(out.Pix); i += 4 {
		out.Pix[i] = uint8(float64(out.Pix[i])*factor + 0.5)
	}
	return out
}

// placeStamp composites the stamp over dst at the requested position. "tile"
// repeats the stamp in a staggered grid across the whole image.
func placeStamp(dst *image.NRGBA, stamp *image.NRGBA, position string, margin int) {
	db := dst.Bounds()
	sw, sh := stamp.Bounds().Dx(), stamp.Bounds().Dy()

	if position == "tile" {
		stepX := sw + sw/2 + margin
		stepY := sh*2 + margin
		row := 0
		for y := db.Min.Y; y < db.Max.Y; y += stepY {
			offset := 0
			if row%2 == 1 {
				offset = -stepX / 2
			}
			for x := db.Min.X + offset; x < db.Max.X; x += stepX {
				drawStampAt(dst, stamp, x, y)
			}
			row++
		}
		return
	}

	var x, y int
	switch position {
	case "top-left":
		x, y = db.Min.X+margin, db.Min.Y+margin
	case "top-right":
		x, y = db.Max.X-sw-margin, db.Min.Y+margin
	case "bottom-left":
		x, y = db.Min.X+margin, db.Max.Y-sh-margin
	case "center":
		x, y = db.Min.X+(db.Dx()-sw)/2, db.Min.Y+(db.Dy()-sh)/2
	default: // bottom-right
		x, y = db.Max.X-sw-margin, db.Max.Y-sh-margin
	}
	drawStampAt(dst, stamp, x, y)
}

func drawStampAt(dst *image.NRGBA, stamp *image.NRGBA, x, y int) {
	target := image.Rect(x, y, x+stamp.Bounds().Dx(), y+stamp.Bounds().Dy())
	draw.Draw(dst, target, stamp, stamp.Bounds().Min, draw.Over)
}
