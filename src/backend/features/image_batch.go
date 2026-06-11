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

// maxBatchImages caps a single batch so one request can't exhaust the machine.
const maxBatchImages = 200

// HandleBatchImage applies one operation to many images and returns a ZIP.
//
// Form fields:
//
//	files     - the uploaded images (any of: files, file, images, image)
//	operation - convert | resize | compress
//	format    - target format for convert (png/jpeg/gif/bmp/tiff); for
//	            compress: jpeg (default) or png
//	quality   - JPEG quality 1-100 (convert/compress)
//	width     - fit-within width in px (resize)
//	height    - fit-within height in px (resize)
//	percent   - scale percentage, overrides width/height (resize)
//	maxWidth  - optional downscale bound (compress)
func HandleBatchImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse upload", http.StatusBadRequest)
		return
	}

	headers := uploadedImageHeaders(r)
	if len(headers) == 0 {
		http.Error(w, "Upload at least one image.", http.StatusBadRequest)
		return
	}
	if len(headers) > maxBatchImages {
		http.Error(w, fmt.Sprintf("Too many images. The limit is %d per batch.", maxBatchImages), http.StatusBadRequest)
		return
	}

	operation := strings.ToLower(strings.TrimSpace(r.FormValue("operation")))
	process, suffix, errMsg := batchOperation(r, operation)
	if process == nil {
		http.Error(w, errMsg, http.StatusBadRequest)
		return
	}

	outDir, err := os.MkdirTemp("", "batch-images-*")
	if err != nil {
		http.Error(w, "Failed to create workspace", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outDir)

	quality := formInt(r, "quality", 85)
	used := make(map[string]int, len(headers))
	outputs := make([]string, 0, len(headers))
	for _, header := range headers {
		img, err := decodeUploadedImage(header)
		if errors.Is(err, errImageTooLarge) {
			http.Error(w, fmt.Sprintf("%q is too large to process safely.", header.Filename), http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to decode %q. Supported inputs: PNG, JPG, GIF, WebP, BMP, TIFF.", header.Filename), http.StatusBadRequest)
			return
		}

		result, format := process(img, header.Filename)
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

	zipFile, err := os.CreateTemp("", "batch-images-*.zip")
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

// batchOperation builds the per-image transform for the requested operation.
// A nil process means the request was invalid and errMsg explains why.
func batchOperation(r *http.Request, operation string) (process func(img image.Image, name string) (image.Image, string), suffix, errMsg string) {
	switch operation {
	case "convert":
		target := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
		if !allowedImageTargets[target] {
			return nil, "", "Unsupported target format. Choose png, jpeg, gif, bmp or tiff."
		}
		format := normalizeOutputFormat(target, "")
		return func(img image.Image, _ string) (image.Image, string) {
			return img, format
		}, "converted", ""

	case "resize":
		percent := formFloat(r, "percent", 0)
		maxW := formInt(r, "width", 0)
		maxH := formInt(r, "height", 0)
		if percent <= 0 && maxW <= 0 && maxH <= 0 {
			return nil, "", "Enter a percentage or a width and/or height."
		}
		return func(img image.Image, name string) (image.Image, string) {
			b := img.Bounds()
			var tw, th int
			if percent > 0 {
				tw = clampDim(int(float64(b.Dx())*percent/100 + 0.5))
				th = clampDim(int(float64(b.Dy())*percent/100 + 0.5))
			} else {
				tw, th = fitDimensions(b.Dx(), b.Dy(), maxW, maxH)
			}
			return resizeImage(img, tw, th), normalizeOutputFormat("keep", formatFromName(name))
		}, "resized", ""

	case "compress":
		format := "jpeg"
		if strings.EqualFold(strings.TrimSpace(r.FormValue("format")), "png") {
			format = "png"
		}
		maxWidth := formInt(r, "maxWidth", 0)
		return func(img image.Image, _ string) (image.Image, string) {
			if maxWidth > 0 && img.Bounds().Dx() > maxWidth {
				tw, th := fitDimensions(img.Bounds().Dx(), img.Bounds().Dy(), maxWidth, 0)
				img = resizeImage(img, tw, th)
			}
			return img, format
		}, "compressed", ""

	default:
		return nil, "", "Unknown operation. Use convert, resize or compress."
	}
}

// uploadedImageHeaders returns the batch upload headers in submission order.
func uploadedImageHeaders(r *http.Request) []*multipart.FileHeader {
	if r.MultipartForm == nil {
		return nil
	}
	for _, name := range []string{"files", "file", "images", "image"} {
		if headers := r.MultipartForm.File[name]; len(headers) > 0 {
			return headers
		}
	}
	return nil
}

func decodeUploadedImage(header *multipart.FileHeader) (image.Image, error) {
	f, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := safeDecodeImage(f)
	return img, err
}

// formatFromName guesses a source format from a filename extension so resized
// batch outputs keep their original format where possible.
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
