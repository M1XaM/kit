package features

import (
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"path/filepath"
	"sort"
)

// receiveSinglePDF parses a single uploaded PDF (form field "file" with an
// "image" fallback, matching the frontend) into a temp file. It returns the
// temp path, the original filename and a cleanup func. On any failure it writes
// the HTTP error response itself and returns ok=false.
func receiveSinglePDF(w http.ResponseWriter, r *http.Request) (inputPath, originalName string, cleanup func(), ok bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return "", "", nil, false
	}

	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return "", "", nil, false
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("image")
	}
	if err != nil {
		file, header, err = r.FormFile("files")
	}
	if err != nil {
		http.Error(w, "PDF file is required", http.StatusBadRequest)
		return "", "", nil, false
	}
	defer file.Close()

	tmpInput, err := os.CreateTemp(tempRoot(), "input-*.pdf")
	if err != nil {
		http.Error(w, "Failed to create temp input file", http.StatusInternalServerError)
		return "", "", nil, false
	}

	if _, err := io.Copy(tmpInput, file); err != nil {
		tmpInput.Close()
		os.Remove(tmpInput.Name())
		http.Error(w, "Failed to save uploaded file", http.StatusInternalServerError)
		return "", "", nil, false
	}
	tmpInput.Close()

	name := tmpInput.Name()
	return name, header.Filename, func() { os.Remove(name) }, true
}

// runSinglePDFOp runs a single-input/single-output pdfcpu operation and streams
// the resulting PDF back with filename "<base>_<suffix>.pdf". On failure it
// responds with errMsg. The op receives input and output temp paths.
func runSinglePDFOp(w http.ResponseWriter, inputPath, originalName, suffix, errMsg string, op func(inPath, outPath string) error) {
	tmpOutput, err := os.CreateTemp(tempRoot(), "output-*.pdf")
	if err != nil {
		http.Error(w, "Failed to create temp output file", http.StatusInternalServerError)
		return
	}
	tmpOutput.Close()
	defer os.Remove(tmpOutput.Name())

	if err := op(inputPath, tmpOutput.Name()); err != nil {
		fmt.Printf("pdf op error: %v\n", err)
		http.Error(w, errMsg, http.StatusBadRequest)
		return
	}

	outFile, err := os.Open(tmpOutput.Name())
	if err != nil {
		http.Error(w, "Failed to open processed file", http.StatusInternalServerError)
		return
	}
	defer outFile.Close()

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s_%s.pdf"`, shared.SafeFileBase(originalName), suffix))
	if _, err := io.Copy(w, outFile); err != nil {
		fmt.Printf("error sending pdf: %v\n", err)
	}
}

// collectFiles returns the absolute paths of all regular files directly inside
// dir, sorted by name.
func collectFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		files = append(files, filepath.Join(dir, entry.Name()))
	}
	sort.Strings(files)
	return files, nil
}
