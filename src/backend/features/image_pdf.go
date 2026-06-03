package features

import (
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"path/filepath"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// HandleImagesToPDF converts one or more uploaded images (form field "files")
// into a single PDF, one image per page.
func HandleImagesToPDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	fileHeaders := r.MultipartForm.File["files"]
	if len(fileHeaders) == 0 {
		fileHeaders = r.MultipartForm.File["file"]
	}
	if len(fileHeaders) == 0 {
		fileHeaders = r.MultipartForm.File["image"]
	}
	if len(fileHeaders) == 0 {
		http.Error(w, "Select at least one image.", http.StatusBadRequest)
		return
	}

	inputDir, err := os.MkdirTemp("", "img2pdf-in-*")
	if err != nil {
		http.Error(w, "Failed to create temp dir", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(inputDir)

	stored, err := storeMultipartFiles(fileHeaders, inputDir)
	if err != nil {
		http.Error(w, "Failed to read uploaded images", http.StatusInternalServerError)
		return
	}
	paths := make([]string, 0, len(stored))
	for _, f := range stored {
		paths = append(paths, f.Path)
	}

	// ImportImagesFile APPENDS to outFile (creating it if missing), so the
	// output path must not already exist — use a path inside a fresh temp dir.
	outDir, err := os.MkdirTemp("", "img2pdf-out-*")
	if err != nil {
		http.Error(w, "Failed to create temp dir", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outDir)
	outPath := filepath.Join(outDir, "images.pdf")

	conf := model.NewDefaultConfiguration()
	if err := api.ImportImagesFile(paths, outPath, nil, conf); err != nil {
		fmt.Printf("image-to-pdf error: %v\n", err)
		http.Error(w, "Failed to convert images to PDF. Ensure the files are valid images (PNG, JPG, etc.).", http.StatusBadRequest)
		return
	}

	outFile, err := os.Open(outPath)
	if err != nil {
		http.Error(w, "Failed to open generated PDF", http.StatusInternalServerError)
		return
	}
	defer outFile.Close()

	downloadName := "images.pdf"
	if len(stored) == 1 {
		downloadName = shared.SafeFileBase(stored[0].Name) + ".pdf"
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, downloadName))
	if _, err := io.Copy(w, outFile); err != nil {
		fmt.Printf("error sending pdf: %v\n", err)
	}
}

// HandlePdfToImages extracts the images embedded in a PDF and returns them as a
// ZIP. Note: this recovers embedded image XObjects (e.g. PDFs built from
// images); it does not rasterize text/vector pages.
func HandlePdfToImages(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	outDir, err := os.MkdirTemp("", "pdf2img-*")
	if err != nil {
		http.Error(w, "Failed to create temp dir", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outDir)

	conf := model.NewDefaultConfiguration()
	if err := api.ExtractImagesFile(inputPath, outDir, nil, conf); err != nil {
		fmt.Printf("pdf-to-images error: %v\n", err)
		http.Error(w, "Failed to extract images. Ensure it is a valid PDF.", http.StatusBadRequest)
		return
	}

	images, err := collectFiles(outDir)
	if err != nil {
		http.Error(w, "Failed to collect extracted images", http.StatusInternalServerError)
		return
	}
	if len(images) == 0 {
		http.Error(w, "No embedded images found. This converter extracts images embedded in a PDF (e.g. PDFs built from images); it does not rasterize text or vector pages.", http.StatusBadRequest)
		return
	}

	zipFile, err := os.CreateTemp("", "pdf2img-*.zip")
	if err != nil {
		http.Error(w, "Failed to create temp zip", http.StatusInternalServerError)
		return
	}
	zipPath := zipFile.Name()
	defer os.Remove(zipPath)

	if err := writeFilesToZip(zipFile, images); err != nil {
		zipFile.Close()
		http.Error(w, "Failed to package images", http.StatusInternalServerError)
		return
	}
	if err := zipFile.Close(); err != nil {
		http.Error(w, "Failed to finalize zip", http.StatusInternalServerError)
		return
	}

	outZip, err := os.Open(zipPath)
	if err != nil {
		http.Error(w, "Failed to open zip", http.StatusInternalServerError)
		return
	}
	defer outZip.Close()

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s_images.zip"`, shared.SafeFileBase(name)))
	if _, err := io.Copy(w, outZip); err != nil {
		fmt.Printf("error sending zip: %v\n", err)
	}
}
