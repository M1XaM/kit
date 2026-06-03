package features

import (
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"strconv"
	"strings"

	// Register decoders for the formats we accept as input. The std library
	// covers png/jpeg/gif; golang.org/x/image adds webp (decode-only), bmp and
	// tiff. Importing for side effects registers them with image.Decode.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	"golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	"golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// maxImageDimension caps any single output dimension so a malformed request
// can't ask us to allocate gigabytes for one image.
const maxImageDimension = 20000

// decodeImage reads and decodes an image from a multipart form field. It tries
// "image" first, then "file", matching the rest of the codebase. On any failure
// it writes the HTTP error itself and returns ok=false.
func receiveSingleImage(w http.ResponseWriter, r *http.Request) (img image.Image, srcFormat, name string, ok bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return nil, "", "", false
	}
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return nil, "", "", false
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		file, header, err = r.FormFile("file")
		if err != nil {
			http.Error(w, "Image file is required", http.StatusBadRequest)
			return nil, "", "", false
		}
	}
	defer file.Close()

	decoded, format, err := image.Decode(file)
	if err != nil {
		http.Error(w, "Failed to decode image. Supported inputs: PNG, JPG, GIF, WebP, BMP, TIFF.", http.StatusBadRequest)
		return nil, "", "", false
	}

	return decoded, format, header.Filename, true
}

// normalizeOutputFormat resolves a requested output format, where "keep" (or an
// empty value) means "reuse the source format". Formats we cannot encode (e.g.
// webp) fall back to PNG so the request still succeeds.
func normalizeOutputFormat(requested, srcFormat string) string {
	format := strings.ToLower(strings.TrimSpace(requested))
	if format == "" || format == "keep" || format == "original" {
		format = strings.ToLower(strings.TrimSpace(srcFormat))
	}
	switch format {
	case "jpg", "jpeg":
		return "jpeg"
	case "png":
		return "png"
	case "gif":
		return "gif"
	case "bmp":
		return "bmp"
	case "tif", "tiff":
		return "tiff"
	default:
		// webp and anything unknown: re-encode losslessly as PNG.
		return "png"
	}
}

// imageContentType maps a normalized format to its MIME type and file extension.
func imageContentType(format string) (contentType, ext string) {
	switch format {
	case "jpeg":
		return "image/jpeg", "jpg"
	case "gif":
		return "image/gif", "gif"
	case "bmp":
		return "image/bmp", "bmp"
	case "tiff":
		return "image/tiff", "tiff"
	default:
		return "image/png", "png"
	}
}

// encodeImage writes img to w in the given normalized format. quality (1-100)
// only affects JPEG. PNG is encoded with the best compression so "compress"
// output is as small as the lossless format allows.
func encodeImage(w interface {
	Write([]byte) (int, error)
}, img image.Image, format string, quality int) error {
	switch format {
	case "jpeg":
		if quality < 1 || quality > 100 {
			quality = 90
		}
		// JPEG cannot carry transparency; flatten onto white first.
		return jpeg.Encode(w, flatten(img, color.White), &jpeg.Options{Quality: quality})
	case "gif":
		return gif.Encode(w, img, &gif.Options{NumColors: 256})
	case "bmp":
		return bmp.Encode(w, img)
	case "tiff":
		return tiff.Encode(w, img, &tiff.Options{Compression: tiff.Deflate})
	default:
		enc := png.Encoder{CompressionLevel: png.BestCompression}
		return enc.Encode(w, img)
	}
}

// flatten composites an image that may have transparency onto a solid
// background, returning an opaque RGBA image. Used before JPEG encoding.
func flatten(src image.Image, bg color.Color) image.Image {
	bounds := src.Bounds()
	out := image.NewRGBA(bounds)
	draw.Draw(out, bounds, image.NewUniform(bg), image.Point{}, draw.Src)
	draw.Draw(out, bounds, src, bounds.Min, draw.Over)
	return out
}

// toRGBA returns src as an *image.RGBA, copying only when necessary. Pixel-level
// filters operate on the returned buffer in place.
func toRGBA(src image.Image) *image.RGBA {
	if rgba, ok := src.(*image.RGBA); ok {
		return rgba
	}
	bounds := src.Bounds()
	out := image.NewRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(out, out.Bounds(), src, bounds.Min, draw.Src)
	return out
}

// resizeImage scales src to exactly w x h using high-quality Catmull-Rom
// resampling. Callers are responsible for preserving aspect ratio if desired.
func resizeImage(src image.Image, w, h int) image.Image {
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	return dst
}

// fitDimensions computes target dimensions for a bounding box (maxW x maxH)
// while preserving aspect ratio. A zero bound means "unconstrained" on that
// axis. The result never upscales beyond the requested box but will shrink to
// fit. Returns the original size when both bounds are zero.
func fitDimensions(srcW, srcH, maxW, maxH int) (int, int) {
	if srcW <= 0 || srcH <= 0 {
		return srcW, srcH
	}
	if maxW <= 0 && maxH <= 0 {
		return srcW, srcH
	}

	scaleW := 1.0
	scaleH := 1.0
	if maxW > 0 {
		scaleW = float64(maxW) / float64(srcW)
	}
	if maxH > 0 {
		scaleH = float64(maxH) / float64(srcH)
	}

	var scale float64
	switch {
	case maxW > 0 && maxH > 0:
		scale = minFloat(scaleW, scaleH)
	case maxW > 0:
		scale = scaleW
	default:
		scale = scaleH
	}

	w := int(float64(srcW)*scale + 0.5)
	h := int(float64(srcH)*scale + 0.5)
	return clampDim(w), clampDim(h)
}

func clampDim(v int) int {
	if v < 1 {
		return 1
	}
	if v > maxImageDimension {
		return maxImageDimension
	}
	return v
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// parseHexColor parses #rgb, #rrggbb or #rrggbbaa (with or without the leading
// '#'). It returns the fallback color when the input is empty or malformed.
func parseHexColor(s string, fallback color.NRGBA) color.NRGBA {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "#")
	if s == "" {
		return fallback
	}

	expand := func(b byte) uint8 {
		v := hexVal(b)
		return uint8(v<<4 | v)
	}

	switch len(s) {
	case 3: // rgb
		return color.NRGBA{R: expand(s[0]), G: expand(s[1]), B: expand(s[2]), A: 255}
	case 6: // rrggbb
		return color.NRGBA{R: hexByte(s[0:2]), G: hexByte(s[2:4]), B: hexByte(s[4:6]), A: 255}
	case 8: // rrggbbaa
		return color.NRGBA{R: hexByte(s[0:2]), G: hexByte(s[2:4]), B: hexByte(s[4:6]), A: hexByte(s[6:8])}
	default:
		return fallback
	}
}

func hexVal(b byte) uint8 {
	switch {
	case b >= '0' && b <= '9':
		return b - '0'
	case b >= 'a' && b <= 'f':
		return b - 'a' + 10
	case b >= 'A' && b <= 'F':
		return b - 'A' + 10
	default:
		return 0
	}
}

func hexByte(s string) uint8 {
	if len(s) != 2 {
		return 0
	}
	return uint8(hexVal(s[0])<<4 | hexVal(s[1]))
}

// formInt reads an integer form value, returning fallback when absent or
// unparseable.
func formInt(r *http.Request, key string, fallback int) int {
	raw := strings.TrimSpace(r.FormValue(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return v
}

// formFloat reads a float form value, returning fallback when absent or
// unparseable.
func formFloat(r *http.Request, key string, fallback float64) float64 {
	raw := strings.TrimSpace(r.FormValue(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return fallback
	}
	return v
}

// writeImageResult streams an encoded image back as an attachment named
// "<base>_<suffix>.<ext>". On encode failure it writes a 500 (only safe before
// any body bytes are flushed, which is the case here since we encode to a
// buffer-less writer only after headers — callers encode directly to w).
func writeImageResult(w http.ResponseWriter, img image.Image, format string, quality int, base, suffix string) {
	contentType, ext := imageContentType(format)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s_%s.%s"`, base, suffix, ext))
	if err := encodeImage(w, img, format, quality); err != nil {
		// Headers are already sent; log only.
		fmt.Printf("image encode error: %v\n", err)
	}
}
