package features

import (
	"archive/zip"
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

func HandleSplitPDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("image")
		if err != nil {
			http.Error(w, "PDF file is required", http.StatusBadRequest)
			return
		}
	}
	defer file.Close()

	mode := strings.TrimSpace(r.FormValue("mode"))
	if mode == "" {
		mode = "range"
	}

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

	conf := model.NewDefaultConfiguration()
	switch mode {
	case "per-page":
		if err := splitPerPageAndSendZip(w, tmpInput.Name(), header.Filename, conf); err != nil {
			fmt.Printf("split per-page error: %v\n", err)
			http.Error(w, "Failed to split PDF per page. Ensure it is a valid PDF.", http.StatusInternalServerError)
			return
		}
	case "range":
		pagesValue := strings.TrimSpace(r.FormValue("pages"))
		if pagesValue == "" {
			http.Error(w, "Page range is required for range mode (example: 1-3,5)", http.StatusBadRequest)
			return
		}

		if err := splitByRangeAndSendPDF(w, tmpInput.Name(), header.Filename, pagesValue, conf); err != nil {
			fmt.Printf("split range error: %v\n", err)
			http.Error(w, "Failed to split PDF by range. Check your range format.", http.StatusBadRequest)
			return
		}
	default:
		http.Error(w, "Invalid mode. Supported modes: range, per-page", http.StatusBadRequest)
		return
	}
}

func splitByRangeAndSendPDF(w http.ResponseWriter, inputPath, originalFileName, pagesValue string, conf *model.Configuration) error {
	tmpOutput, err := os.CreateTemp("", "split-range-*.pdf")
	if err != nil {
		return err
	}
	tmpOutput.Close()
	defer os.Remove(tmpOutput.Name())

	selectedPages := []string{pagesValue}
	if err := api.TrimFile(inputPath, tmpOutput.Name(), selectedPages, conf); err != nil {
		return err
	}

	outFile, err := os.Open(tmpOutput.Name())
	if err != nil {
		return err
	}
	defer outFile.Close()

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s_split_%s.pdf"`, shared.SafeFileBase(originalFileName), sanitizeRangeForFile(pagesValue)))

	_, err = io.Copy(w, outFile)
	return err
}

func splitPerPageAndSendZip(w http.ResponseWriter, inputPath, originalFileName string, conf *model.Configuration) error {
	outDir, err := os.MkdirTemp("", "split-pages-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(outDir)

	if err := api.SplitFile(inputPath, outDir, 1, conf); err != nil {
		return err
	}

	pdfFiles, err := collectGeneratedPDFs(outDir)
	if err != nil {
		return err
	}
	if len(pdfFiles) == 0 {
		return fmt.Errorf("no split pages generated")
	}

	zipFile, err := os.CreateTemp("", "split-pages-*.zip")
	if err != nil {
		return err
	}
	zipPath := zipFile.Name()
	defer os.Remove(zipPath)

	if err := writeFilesToZip(zipFile, pdfFiles); err != nil {
		zipFile.Close()
		return err
	}
	if err := zipFile.Close(); err != nil {
		return err
	}

	outZip, err := os.Open(zipPath)
	if err != nil {
		return err
	}
	defer outZip.Close()

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s_split_pages.zip"`, shared.SafeFileBase(originalFileName)))

	_, err = io.Copy(w, outZip)
	return err
}

func collectGeneratedPDFs(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.EqualFold(filepath.Ext(name), ".pdf") {
			files = append(files, filepath.Join(dir, name))
		}
	}

	sort.Strings(files)
	return files, nil
}

func writeFilesToZip(zipFile *os.File, filePaths []string) error {
	zw := zip.NewWriter(zipFile)
	for _, filePath := range filePaths {
		if err := addFileToZip(zw, filePath); err != nil {
			_ = zw.Close()
			return err
		}
	}
	return zw.Close()
}

func addFileToZip(zw *zip.Writer, filePath string) error {
	source, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer source.Close()

	writer, err := zw.Create(filepath.Base(filePath))
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, source)
	return err
}

func sanitizeRangeForFile(pageRange string) string {
	replacer := strings.NewReplacer(
		" ", "",
		",", "_",
		";", "_",
		":", "-",
		"/", "-",
		"\\", "-",
	)
	sanitized := replacer.Replace(pageRange)
	if sanitized == "" {
		return "range"
	}
	return sanitized
}
