package features

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// HandleExtractPages keeps only the selected pages (e.g. "1-3,5").
func HandleExtractPages(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	pages := strings.TrimSpace(r.FormValue("pages"))
	if pages == "" {
		http.Error(w, "Page selection is required (example: 1-3,5)", http.StatusBadRequest)
		return
	}

	conf := model.NewDefaultConfiguration()
	runSinglePDFOp(w, inputPath, name, "pages_"+sanitizeRangeForFile(pages),
		"Failed to extract pages. Check your page selection (example: 1-3,5).",
		func(in, out string) error {
			return api.TrimFile(in, out, []string{pages}, conf)
		})
}

// HandleDeletePages removes the selected pages from the PDF.
func HandleDeletePages(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	pages := strings.TrimSpace(r.FormValue("pages"))
	if pages == "" {
		http.Error(w, "Page selection is required (example: 2,4-6)", http.StatusBadRequest)
		return
	}

	conf := model.NewDefaultConfiguration()
	runSinglePDFOp(w, inputPath, name, "trimmed",
		"Failed to delete pages. Check your page selection (example: 2,4-6).",
		func(in, out string) error {
			return api.RemovePagesFile(in, out, []string{pages}, conf)
		})
}

// HandleReorderPages writes pages in a custom order (e.g. "3,1,2").
func HandleReorderPages(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	order := strings.TrimSpace(r.FormValue("order"))
	if order == "" {
		http.Error(w, "Page order is required (example: 3,1,2)", http.StatusBadRequest)
		return
	}

	// api.CollectFile expects each entry to be a single page number, so split
	// the comma/space separated order into individual page tokens.
	orderPages := strings.FieldsFunc(order, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t'
	})
	if len(orderPages) == 0 {
		http.Error(w, "Page order is required (example: 3,1,2)", http.StatusBadRequest)
		return
	}

	conf := model.NewDefaultConfiguration()
	runSinglePDFOp(w, inputPath, name, "reordered",
		"Failed to reorder pages. Check your order list (example: 3,1,2).",
		func(in, out string) error {
			return api.CollectFile(in, out, orderPages, conf)
		})
}

// HandleRotatePDF rotates pages clockwise by 90/180/270 degrees. An optional
// "pages" selection limits the rotation; empty means all pages.
func HandleRotatePDF(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	rotationStr := strings.TrimSpace(r.FormValue("rotation"))
	if rotationStr == "" {
		rotationStr = "90"
	}
	rotation, err := strconv.Atoi(rotationStr)
	if err != nil || !isValidRotation(rotation) {
		http.Error(w, "Rotation must be one of 90, 180, 270 (or their negatives).", http.StatusBadRequest)
		return
	}

	var selectedPages []string
	if pages := strings.TrimSpace(r.FormValue("pages")); pages != "" {
		selectedPages = []string{pages}
	}

	conf := model.NewDefaultConfiguration()
	runSinglePDFOp(w, inputPath, name, "rotated",
		"Failed to rotate PDF. Ensure the file and page selection are valid.",
		func(in, out string) error {
			return api.RotateFile(in, out, rotation, selectedPages, conf)
		})
}

func isValidRotation(deg int) bool {
	switch deg {
	case 90, 180, 270, -90, -180, -270:
		return true
	default:
		return false
	}
}
