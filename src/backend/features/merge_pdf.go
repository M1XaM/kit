package features

import (
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// HandleMergePDF merges multiple uploaded PDFs (form field "files", in upload
// order) into a single PDF.
func HandleMergePDF(w http.ResponseWriter, r *http.Request) {
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
	if len(fileHeaders) < 2 {
		http.Error(w, "Select at least two PDF files to merge.", http.StatusBadRequest)
		return
	}

	inputDir, err := os.MkdirTemp(tempRoot(), "merge-pdf-*")
	if err != nil {
		http.Error(w, "Failed to create temp dir", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(inputDir)

	stored, err := storeMultipartFiles(fileHeaders, inputDir)
	if err != nil {
		http.Error(w, "Failed to read uploaded files", http.StatusInternalServerError)
		return
	}

	paths := make([]string, 0, len(stored))
	for _, f := range stored {
		paths = append(paths, f.Path)
	}

	outFile, err := os.CreateTemp(tempRoot(), "merged-*.pdf")
	if err != nil {
		http.Error(w, "Failed to create temp output file", http.StatusInternalServerError)
		return
	}
	outFile.Close()
	defer os.Remove(outFile.Name())

	conf := model.NewDefaultConfiguration()
	if err := api.MergeCreateFile(paths, outFile.Name(), false, conf); err != nil {
		fmt.Printf("merge error: %v\n", err)
		http.Error(w, "Failed to merge PDFs. Ensure all files are valid PDFs.", http.StatusBadRequest)
		return
	}

	merged, err := os.Open(outFile.Name())
	if err != nil {
		http.Error(w, "Failed to open merged file", http.StatusInternalServerError)
		return
	}
	defer merged.Close()

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="merged.pdf"`)
	if _, err := io.Copy(w, merged); err != nil {
		fmt.Printf("error sending merged pdf: %v\n", err)
	}
}
