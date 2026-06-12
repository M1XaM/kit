package features

import (
	"errors"
	"fmt"
	"image"
	"local-tools-hub/backend/features/shared"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Every image endpoint accepts one or many uploads through the same form
// fields. One image streams straight back; several are processed with the same
// settings and returned as a ZIP, which is what powers the per-feature "batch
// processing" checkbox in the UI.

// maxBatchImages caps a single request so one upload can't exhaust the machine.
const maxBatchImages = 200

// imageTransform turns one decoded input into the output image and its
// normalized output format.
type imageTransform func(img image.Image, srcFormat, name string) (image.Image, string, error)

// receiveImages parses the multipart form and returns the uploaded image file
// headers in submission order. On any failure it writes the HTTP error itself
// and returns ok=false.
func receiveImages(w http.ResponseWriter, r *http.Request) ([]*multipart.FileHeader, bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return nil, false
	}
	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return nil, false
	}
	headers := uploadedImageHeaders(r)
	if len(headers) == 0 {
		http.Error(w, "Image file is required", http.StatusBadRequest)
		return nil, false
	}
	if len(headers) > maxBatchImages {
		http.Error(w, fmt.Sprintf("Too many images. The limit is %d per batch.", maxBatchImages), http.StatusBadRequest)
		return nil, false
	}
	return headers, true
}

// uploadedImageHeaders returns the upload headers in submission order.
func uploadedImageHeaders(r *http.Request) []*multipart.FileHeader {
	if r.MultipartForm == nil {
		return nil
	}
	for _, name := range []string{"image", "file", "images", "files"} {
		if headers := r.MultipartForm.File[name]; len(headers) > 0 {
			return headers
		}
	}
	return nil
}

func decodeUploadedImage(header *multipart.FileHeader) (image.Image, string, error) {
	f, err := header.Open()
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	return safeDecodeImage(f)
}

// serveProcessedImages runs transform over every upload. A single result is
// streamed back directly as "<base>_<suffix>.<ext>"; multiple results are
// packed into "batch_<suffix>.zip". Any per-file failure aborts the request
// with a message naming the offending file.
func serveProcessedImages(w http.ResponseWriter, headers []*multipart.FileHeader, transform imageTransform, suffix string, quality int) {
	if len(headers) == 1 {
		img, srcFormat, err := decodeUploadedImage(headers[0])
		if writeDecodeError(w, err, headers[0].Filename) {
			return
		}
		out, format, err := transform(img, srcFormat, headers[0].Filename)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeImageResult(w, out, format, quality, shared.SafeFileBase(headers[0].Filename), suffix)
		return
	}

	outDir, err := os.MkdirTemp("", "kit-images-*")
	if err != nil {
		http.Error(w, "Failed to create workspace", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outDir)

	used := make(map[string]int, len(headers))
	outputs := make([]string, 0, len(headers))
	for _, header := range headers {
		img, srcFormat, err := decodeUploadedImage(header)
		if writeDecodeError(w, err, header.Filename) {
			return
		}
		result, format, err := transform(img, srcFormat, header.Filename)
		if err != nil {
			http.Error(w, fmt.Sprintf("%s: %s", header.Filename, err.Error()), http.StatusBadRequest)
			return
		}
		_, ext := imageContentType(format)
		outName := uniqueFileName(fmt.Sprintf("%s_%s.%s", shared.SafeFileBase(header.Filename), suffix, ext), used)
		outPath := filepath.Join(outDir, outName)

		outFile, err := os.Create(outPath)
		if err != nil {
			http.Error(w, "Failed to write an output image", http.StatusInternalServerError)
			return
		}
		if err := encodeImage(outFile, result, format, quality); err != nil {
			outFile.Close()
			http.Error(w, fmt.Sprintf("Failed to encode %q.", header.Filename), http.StatusInternalServerError)
			return
		}
		outFile.Close()
		outputs = append(outputs, outPath)
	}

	zipFile, err := os.CreateTemp("", "kit-images-*.zip")
	if err != nil {
		http.Error(w, "Failed to create archive", http.StatusInternalServerError)
		return
	}
	zipPath := zipFile.Name()
	defer os.Remove(zipPath)

	if err := writeFilesToZip(zipFile, outputs); err != nil {
		zipFile.Close()
		fmt.Printf("batch zip error: %v\n", err)
		http.Error(w, "Failed to archive the processed images.", http.StatusInternalServerError)
		return
	}
	zipFile.Close()

	if err := sendFile(w, zipPath, fmt.Sprintf("batch_%s.zip", suffix), "application/zip"); err != nil {
		fmt.Printf("batch send error: %v\n", err)
	}
}

// writeDecodeError reports a decode failure (when err != nil) and returns
// whether the request has been answered.
func writeDecodeError(w http.ResponseWriter, err error, name string) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errImageTooLarge) {
		http.Error(w, fmt.Sprintf("%q is too large to process safely.", name), http.StatusBadRequest)
		return true
	}
	http.Error(w, fmt.Sprintf("Failed to decode %q. Supported inputs: PNG, JPG, GIF, WebP, BMP, TIFF.", name), http.StatusBadRequest)
	return true
}

// formatFromName guesses a source format from a filename extension so batch
// outputs keep their original format where possible.
func formatFromName(name string) string {
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(name), ".")) {
	case "jpg", "jpeg":
		return "jpeg"
	case "gif":
		return "gif"
	case "bmp":
		return "bmp"
	case "tif", "tiff":
		return "tiff"
	default:
		return "png"
	}
}
