package features

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
)

var hexColorPattern = regexp.MustCompile(`^#?[0-9a-fA-F]{6}$`)

// HandleWatermarkPDF stamps a text or image watermark onto a PDF via pdfcpu.
//
// Form fields:
//
//	file      - the PDF to watermark
//	type      - "text" (default) or "image"
//	text      - watermark text (type=text)
//	watermark - watermark image file, PNG/JPG (type=image)
//	layer     - "above" (stamp, default) or "below" (background watermark)
//	opacity   - 5-100 (default 30)
//	rotation  - degrees -180..180 (default 45 for text, 0 for image)
//	color     - text color as #rrggbb hex (type=text, default #808080)
//	fontSize  - text size in points (type=text, default 48)
//	scale     - image width relative to the page, 1-100% (type=image, default 50)
//	pages     - optional page selection like "1-3,5" (default: all pages)
func HandleWatermarkPDF(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	onTop := !strings.EqualFold(strings.TrimSpace(r.FormValue("layer")), "below")
	opacity := clampRange(formFloat(r, "opacity", 30), 5, 100) / 100

	var selectedPages []string
	if pages := strings.TrimSpace(r.FormValue("pages")); pages != "" {
		for _, part := range strings.Split(pages, ",") {
			if part = strings.TrimSpace(part); part != "" {
				selectedPages = append(selectedPages, part)
			}
		}
	}

	wmType := strings.ToLower(strings.TrimSpace(r.FormValue("type")))
	switch wmType {
	case "image":
		wmFile, _, err := r.FormFile("watermark")
		if err != nil {
			http.Error(w, "A watermark image is required.", http.StatusBadRequest)
			return
		}
		defer wmFile.Close()

		rotation := int(clampRange(formFloat(r, "rotation", 0), -180, 180))
		scale := clampRange(formFloat(r, "scale", 50), 1, 100) / 100
		desc := fmt.Sprintf("op:%.2f, rot:%d, scale:%.2f rel", opacity, rotation, scale)

		wm, err := api.ImageWatermarkForReader(wmFile, desc, onTop, false, types.POINTS)
		if err != nil {
			fmt.Printf("pdf image watermark config error: %v\n", err)
			http.Error(w, "Invalid watermark settings.", http.StatusBadRequest)
			return
		}
		runSinglePDFOp(w, inputPath, name, "watermarked",
			"Failed to watermark PDF. Ensure it is a valid, unencrypted PDF and the watermark is a PNG or JPG image.",
			func(in, out string) error {
				return api.AddWatermarksFile(in, out, selectedPages, wm, nil)
			})

	case "", "text":
		text := strings.TrimSpace(r.FormValue("text"))
		if text == "" {
			http.Error(w, "Watermark text is required.", http.StatusBadRequest)
			return
		}
		fontSize := formInt(r, "fontSize", 48)
		if fontSize < 6 {
			fontSize = 6
		}
		if fontSize > 200 {
			fontSize = 200
		}
		rotation := int(clampRange(formFloat(r, "rotation", 45), -180, 180))
		color := strings.TrimSpace(r.FormValue("color"))
		if !hexColorPattern.MatchString(color) {
			color = "#808080"
		} else if !strings.HasPrefix(color, "#") {
			color = "#" + color
		}
		desc := fmt.Sprintf("font:Helvetica, points:%d, scale:1 abs, rot:%d, op:%.2f, fillc:%s", fontSize, rotation, opacity, color)

		wm, err := api.TextWatermark(text, desc, onTop, false, types.POINTS)
		if err != nil {
			fmt.Printf("pdf text watermark config error: %v\n", err)
			http.Error(w, "Invalid watermark settings.", http.StatusBadRequest)
			return
		}
		runSinglePDFOp(w, inputPath, name, "watermarked",
			"Failed to watermark PDF. Ensure it is a valid, unencrypted PDF.",
			func(in, out string) error {
				return api.AddWatermarksFile(in, out, selectedPages, wm, nil)
			})

	default:
		http.Error(w, "Invalid type. Supported types: text, image.", http.StatusBadRequest)
	}
}
