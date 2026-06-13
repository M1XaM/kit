package features

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"

	"local-tools-hub/backend/features/shared"
)

func HandleArchiveCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	format := normalizeCreateFormat(r.FormValue("format"))
	if format == "" {
		http.Error(w, "Unsupported archive format", http.StatusBadRequest)
		return
	}

	fileHeaders := r.MultipartForm.File["files"]
	if len(fileHeaders) == 0 {
		fileHeaders = r.MultipartForm.File["file"]
	}

	if len(fileHeaders) == 0 {
		http.Error(w, "Please select at least one file", http.StatusBadRequest)
		return
	}

	inputDir, err := os.MkdirTemp(tempRoot(), "archive-create-*")
	if err != nil {
		http.Error(w, "Failed to prepare workspace", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(inputDir)

	storedFiles, err := storeMultipartFiles(fileHeaders, inputDir)
	if err != nil {
		http.Error(w, "Failed to save uploaded files", http.StatusInternalServerError)
		return
	}

	outputExt := archiveExtension(format)
	if outputExt == "" {
		http.Error(w, "Unsupported archive format", http.StatusBadRequest)
		return
	}

	tmpOutput, err := os.CreateTemp(tempRoot(), "archive-*"+outputExt)
	if err != nil {
		http.Error(w, "Failed to prepare output archive", http.StatusInternalServerError)
		return
	}
	tmpOutput.Close()
	defer os.Remove(tmpOutput.Name())

	if err := createArchiveFile(format, tmpOutput.Name(), inputDir, storedFiles); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	outputBase := "archive"
	if len(fileHeaders) == 1 {
		outputBase = shared.SafeFileBase(fileHeaders[0].Filename)
	}

	outputName := outputBase + outputExt
	w.Header().Set("Content-Type", archiveContentType(format))
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", outputName))

	outputFile, err := os.Open(tmpOutput.Name())
	if err != nil {
		http.Error(w, "Failed to open output archive", http.StatusInternalServerError)
		return
	}
	defer outputFile.Close()

	if _, err := io.Copy(w, outputFile); err != nil {
		fmt.Printf("Error sending archive: %v\n", err)
	}
}

func createArchiveFile(format, outputPath, inputDir string, files []storedFile) error {
	if formatNeeds7z(format) {
		names := make([]string, 0, len(files))
		for _, file := range files {
			names = append(names, file.Name)
		}
		return createWith7z(format, outputPath, inputDir, names)
	}

	switch format {
	case "zip":
		return createZipArchive(outputPath, files)
	case "tar":
		return createTarArchive(outputPath, files, false)
	case "tar.gz":
		return createTarArchive(outputPath, files, true)
	default:
		return fmt.Errorf("Unsupported archive format")
	}
}

func createZipArchive(outputPath string, files []storedFile) error {
	outFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	zipWriter := zip.NewWriter(outFile)
	defer zipWriter.Close()

	for _, file := range files {
		if err := addStoredFileToZip(zipWriter, file); err != nil {
			return err
		}
	}

	return nil
}

func addStoredFileToZip(zipWriter *zip.Writer, file storedFile) error {
	source, err := os.Open(file.Path)
	if err != nil {
		return err
	}
	defer source.Close()

	info, err := source.Stat()
	if err != nil {
		return err
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	header.Name = file.Name
	header.Method = zip.Deflate

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}

	_, err = io.Copy(writer, source)
	return err
}

func createTarArchive(outputPath string, files []storedFile, gzipCompress bool) error {
	outFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer outFile.Close()

	var writer io.WriteCloser = outFile
	if gzipCompress {
		gzipWriter := gzip.NewWriter(outFile)
		writer = gzipWriter
	}

	tarWriter := tar.NewWriter(writer)
	for _, file := range files {
		if err := addFileToTar(tarWriter, file); err != nil {
			_ = tarWriter.Close()
			if gzipCompress {
				_ = writer.Close()
			}
			return err
		}
	}

	if err := tarWriter.Close(); err != nil {
		if gzipCompress {
			_ = writer.Close()
		}
		return err
	}

	if gzipCompress {
		return writer.Close()
	}

	return nil
}

func addFileToTar(tarWriter *tar.Writer, file storedFile) error {
	source, err := os.Open(file.Path)
	if err != nil {
		return err
	}
	defer source.Close()

	info, err := source.Stat()
	if err != nil {
		return err
	}

	mode := info.Mode().Perm()
	if mode == 0 {
		mode = 0644
	}

	header := &tar.Header{
		Name:    file.Name,
		Mode:    int64(mode),
		Size:    info.Size(),
		ModTime: info.ModTime(),
	}

	if err := tarWriter.WriteHeader(header); err != nil {
		return err
	}

	_, err = io.Copy(tarWriter, source)
	return err
}
