package features

import (
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func HandleCompressPDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	err := r.ParseMultipartForm(50 << 20)
	if err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("image") // fallback based on frontend
		if err != nil {
			http.Error(w, "PDF file is required", http.StatusBadRequest)
			return
		}
	}
	defer file.Close()

	tmpInput, err := os.CreateTemp("", "input-*.pdf")
	if err != nil {
		http.Error(w, "Failed to create temp input file", http.StatusInternalServerError)
		return
	}
	defer os.Remove(tmpInput.Name())

	if _, err := io.Copy(tmpInput, file); err != nil {
		tmpInput.Close()
		http.Error(w, "Failed to save uploaded file", http.StatusInternalServerError)
		return
	}
	tmpInput.Close()

	tmpOutput, err := os.CreateTemp("", "output-*.pdf")
	if err != nil {
		http.Error(w, "Failed to create temp output file", http.StatusInternalServerError)
		return
	}
	tmpOutput.Close()
	defer os.Remove(tmpOutput.Name())

	conf := model.NewDefaultConfiguration()
	err = api.OptimizeFile(tmpInput.Name(), tmpOutput.Name(), conf)
	if err != nil {
		fmt.Printf("pdfcpu error: %v\n", err)
		http.Error(w, "Failed to compress PDF natively. Ensure it is a valid PDF.", http.StatusInternalServerError)
		return
	}

	compressedFile, err := os.Open(tmpOutput.Name())
	if err != nil {
		http.Error(w, "Failed to open processed file", http.StatusInternalServerError)
		return
	}
	defer compressedFile.Close()

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="compressed_%s"`, shared.SafeFileName(header.Filename)))

	_, err = io.Copy(w, compressedFile)
	if err != nil {
		fmt.Printf("Error sending compressed PDF: %v\n", err)
	} else {
		fmt.Printf("Successfully compressed %s\n", header.Filename)
	}
}
