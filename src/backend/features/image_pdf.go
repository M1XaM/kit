package features

import (
	"context"
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

	inputDir, err := os.MkdirTemp(tempRoot(), "img2pdf-in-*")
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
	outDir, err := os.MkdirTemp(tempRoot(), "img2pdf-out-*")
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

// pdfRasterTimeout caps one PDF rasterization run.
const pdfRasterTimeout = 10 * time.Minute

// rasterizePDF renders every page of the PDF into images in outDir using the
// first available rasterizer: pdftoppm (poppler), Ghostscript, or mutool.
// Returns false when no rasterizer is installed; a found-but-failed tool is an
// error.
func rasterizePDF(inputPath, outDir, format string, dpi int) (bool, error) {
	jpeg := format == "jpeg" || format == "jpg"

	ctx, cancel := context.WithTimeout(context.Background(), pdfRasterTimeout)
	defer cancel()

	if bin, err := exec.LookPath("pdftoppm"); err == nil {
		args := []string{"-r", strconv.Itoa(dpi)}
		if jpeg {
			args = append(args, "-jpeg")
		} else {
			args = append(args, "-png")
		}
		args = append(args, inputPath, filepath.Join(outDir, "page"))
		out, err := combinedOutputGated(ctx, hiddenCommandContext(ctx, bin, args...))
		if err != nil {
			return true, fmt.Errorf("pdftoppm: %v: %s", err, strings.TrimSpace(string(out)))
		}
		return true, nil
	}

	if bin, ok := ghostscriptPath(); ok {
		device := "png16m"
		ext := "png"
		if jpeg {
			device = "jpeg"
			ext = "jpg"
		}
		out, err := combinedOutputGated(ctx, hiddenCommandContext(ctx, bin,
			"-sDEVICE="+device,
			"-r"+strconv.Itoa(dpi),
			"-dNOPAUSE", "-dQUIET", "-dBATCH", "-dSAFER",
			"-o", filepath.Join(outDir, "page-%03d."+ext),
			inputPath,
		))
		if err != nil {
			return true, fmt.Errorf("ghostscript: %v: %s", err, strings.TrimSpace(string(out)))
		}
		return true, nil
	}

	if bin, err := exec.LookPath("mutool"); err == nil {
		// mutool draw encodes JPEG only in newer builds; PNG is universal.
		out, err := combinedOutputGated(ctx, hiddenCommandContext(ctx, bin, "draw",
			"-r", strconv.Itoa(dpi),
			"-o", filepath.Join(outDir, "page-%03d.png"),
			inputPath,
		))
		if err != nil {
			return true, fmt.Errorf("mutool: %v: %s", err, strings.TrimSpace(string(out)))
		}
		return true, nil
	}

	return false, nil
}

// HandlePdfToImages converts a PDF to images and returns them as a ZIP. Pages
// are rasterized with pdftoppm/Ghostscript/mutool when one of those tools is
// installed (so text and vector pages convert too); otherwise it falls back to
// extracting the images embedded in the PDF.
//
// Form fields:
//
//	file   - the PDF
//	format - png (default) or jpeg
//	dpi    - render resolution, 36-600 (default 150)
func HandlePdfToImages(w http.ResponseWriter, r *http.Request) {
	inputPath, name, cleanup, ok := receiveSinglePDF(w, r)
	if !ok {
		return
	}
	defer cleanup()

	outDir, err := os.MkdirTemp(tempRoot(), "pdf2img-*")
	if err != nil {
		http.Error(w, "Failed to create temp dir", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outDir)

	format := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
	dpi := formInt(r, "dpi", 150)
	if dpi < 36 {
		dpi = 36
	}
	if dpi > 600 {
		dpi = 600
	}

	rasterized, rasterErr := rasterizePDF(inputPath, outDir, format, dpi)
	if rasterErr != nil {
		fmt.Printf("pdf rasterize error: %v\n", rasterErr)
		http.Error(w, "Failed to render the PDF pages. Ensure it is a valid, unencrypted PDF.", http.StatusBadRequest)
		return
	}
	if !rasterized {
		// No rasterizer on this machine: fall back to extracting embedded
		// image objects, which still covers scanned/image-built PDFs.
		conf := model.NewDefaultConfiguration()
		if err := api.ExtractImagesFile(inputPath, outDir, nil, conf); err != nil {
			fmt.Printf("pdf-to-images error: %v\n", err)
			http.Error(w, "Failed to extract images. Ensure it is a valid PDF.", http.StatusBadRequest)
			return
		}
	}

	images, err := collectFiles(outDir)
	if err != nil {
		http.Error(w, "Failed to collect extracted images", http.StatusInternalServerError)
		return
	}
	if len(images) == 0 {
		http.Error(w, "No images could be produced. Install poppler (pdftoppm), Ghostscript or mupdf-tools to convert text/vector pages; without them only embedded images can be extracted.", http.StatusBadRequest)
		return
	}

	zipFile, err := os.CreateTemp(tempRoot(), "pdf2img-*.zip")
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
