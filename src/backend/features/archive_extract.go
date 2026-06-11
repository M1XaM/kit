package features

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"local-tools-hub/backend/features/shared"
)

func HandleArchiveExtract(w http.ResponseWriter, r *http.Request) {
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
		file, header, err = r.FormFile("archive")
		if err != nil {
			http.Error(w, "Archive file is required", http.StatusBadRequest)
			return
		}
	}
	defer file.Close()

	format := detectArchiveFormat(header.Filename)
	if format == "" {
		http.Error(w, "Unsupported archive format", http.StatusBadRequest)
		return
	}

	tmpInput, err := os.CreateTemp("", "archive-input-*")
	if err != nil {
		http.Error(w, "Failed to prepare archive", http.StatusInternalServerError)
		return
	}
	defer os.Remove(tmpInput.Name())

	if _, err := io.Copy(tmpInput, file); err != nil {
		tmpInput.Close()
		http.Error(w, "Failed to save uploaded archive", http.StatusInternalServerError)
		return
	}
	tmpInput.Close()

	outputDir, err := os.MkdirTemp("", "archive-output-*")
	if err != nil {
		http.Error(w, "Failed to prepare output folder", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outputDir)

	if err := extractArchiveFile(tmpInput.Name(), format, outputDir, header.Filename); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	zipOutput, err := os.CreateTemp("", "archive-extracted-*.zip")
	if err != nil {
		http.Error(w, "Failed to prepare output archive", http.StatusInternalServerError)
		return
	}
	zipOutput.Close()
	defer os.Remove(zipOutput.Name())

	fileCount, err := zipDirectory(outputDir, zipOutput.Name())
	if err != nil {
		http.Error(w, "Failed to package extracted files", http.StatusInternalServerError)
		return
	}
	if fileCount == 0 {
		http.Error(w, "Archive extracted zero files", http.StatusBadRequest)
		return
	}

	outputName := fmt.Sprintf("%s_extracted.zip", shared.SafeFileBase(header.Filename))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", outputName))

	outFile, err := os.Open(zipOutput.Name())
	if err != nil {
		http.Error(w, "Failed to open output archive", http.StatusInternalServerError)
		return
	}
	defer outFile.Close()

	if _, err := io.Copy(w, outFile); err != nil {
		fmt.Printf("Error sending extracted files: %v\n", err)
	}
}

// Decompression-bomb guards: a tiny archive can decompress to petabytes, so
// extraction stops once it would exceed either budget.
const (
	maxExtractFiles = 50_000
	maxExtractBytes = int64(8) << 30
)

// extractBudget tracks cumulative extracted file count and decompressed bytes
// across all entries of one archive.
type extractBudget struct {
	files int
	bytes int64
}

func (b *extractBudget) addFile() error {
	b.files++
	if b.files > maxExtractFiles {
		return fmt.Errorf("archive contains too many files (limit %d)", maxExtractFiles)
	}
	return nil
}

// copy streams one entry while enforcing the total decompressed-size budget.
func (b *extractBudget) copy(dst io.Writer, src io.Reader) error {
	n, err := io.Copy(dst, io.LimitReader(src, maxExtractBytes-b.bytes+1))
	b.bytes += n
	if b.bytes > maxExtractBytes {
		return fmt.Errorf("archive decompresses to more than the supported size (%d GB)", maxExtractBytes>>30)
	}
	return err
}

func extractArchiveFile(inputPath, format, outputDir, originalName string) error {
	if formatNeeds7z(format) {
		if err := extractWith7z(inputPath, outputDir); err != nil {
			return fmt.Errorf("Unsupported archive format (install 7z to enable): %w", err)
		}
		return nil
	}

	budget := &extractBudget{}
	switch format {
	case "zip":
		return extractZipArchive(inputPath, outputDir, budget)
	case "tar":
		return extractTarArchive(inputPath, outputDir, budget)
	case "tar.gz":
		return extractTarGzipArchive(inputPath, outputDir, budget)
	case "gz":
		return extractGzipFile(inputPath, outputDir, originalName, budget)
	default:
		return fmt.Errorf("Unsupported archive format")
	}
}

func extractZipArchive(inputPath, outputDir string, budget *extractBudget) error {
	reader, err := zip.OpenReader(inputPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	for _, file := range reader.File {
		if err := extractZipEntry(file, outputDir, budget); err != nil {
			return err
		}
	}

	return nil
}

func extractZipEntry(file *zip.File, outputDir string, budget *extractBudget) error {
	cleaned, err := safeArchivePath(outputDir, file.Name)
	if err != nil {
		return err
	}

	if file.FileInfo().IsDir() {
		return os.MkdirAll(cleaned, 0755)
	}
	if file.FileInfo().Mode()&os.ModeSymlink != 0 {
		return nil
	}
	if err := budget.addFile(); err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(cleaned), 0755); err != nil {
		return err
	}

	source, err := file.Open()
	if err != nil {
		return err
	}
	defer source.Close()

	mode := file.Mode().Perm()
	if mode == 0 {
		mode = 0644
	}

	target, err := os.OpenFile(cleaned, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer target.Close()

	return budget.copy(target, source)
}

func extractTarArchive(inputPath, outputDir string, budget *extractBudget) error {
	file, err := os.Open(inputPath)
	if err != nil {
		return err
	}
	defer file.Close()

	return extractTarStream(tar.NewReader(file), outputDir, budget)
}

func extractTarGzipArchive(inputPath, outputDir string, budget *extractBudget) error {
	file, err := os.Open(inputPath)
	if err != nil {
		return err
	}
	defer file.Close()

	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	return extractTarStream(tar.NewReader(gzipReader), outputDir, budget)
}

func extractTarStream(reader *tar.Reader, outputDir string, budget *extractBudget) error {
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}

		if header == nil {
			continue
		}

		if header.Typeflag == tar.TypeSymlink || header.Typeflag == tar.TypeLink {
			continue
		}

		cleaned, err := safeArchivePath(outputDir, header.Name)
		if err != nil {
			return err
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(cleaned, 0755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := budget.addFile(); err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(cleaned), 0755); err != nil {
				return err
			}

			mode := os.FileMode(header.Mode).Perm()
			if mode == 0 {
				mode = 0644
			}

			target, err := os.OpenFile(cleaned, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}

			if err := budget.copy(target, reader); err != nil {
				target.Close()
				return err
			}
			if err := target.Close(); err != nil {
				return err
			}
		}
	}
}

func extractGzipFile(inputPath, outputDir, originalName string, budget *extractBudget) error {
	input, err := os.Open(inputPath)
	if err != nil {
		return err
	}
	defer input.Close()

	gzipReader, err := gzip.NewReader(input)
	if err != nil {
		return err
	}
	defer gzipReader.Close()

	outputName := strings.TrimSuffix(filepath.Base(originalName), ".gz")
	outputName = shared.SafeFileName(outputName)
	if outputName == "" {
		outputName = "output"
	}

	targetPath := filepath.Join(outputDir, outputName)
	target, err := os.Create(targetPath)
	if err != nil {
		return err
	}
	defer target.Close()

	if err := budget.addFile(); err != nil {
		return err
	}
	return budget.copy(target, gzipReader)
}

func safeArchivePath(baseDir, name string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(name))
	cleaned = strings.TrimPrefix(cleaned, string(filepath.Separator))

	if cleaned == "." || cleaned == "" {
		return "", fmt.Errorf("invalid archive path")
	}

	if strings.HasPrefix(cleaned, "..") {
		return "", fmt.Errorf("invalid archive path")
	}

	targetPath := filepath.Join(baseDir, cleaned)
	if !strings.HasPrefix(targetPath, baseDir+string(filepath.Separator)) && targetPath != baseDir {
		return "", fmt.Errorf("invalid archive path")
	}

	return targetPath, nil
}

func zipDirectory(sourceDir, outputPath string) (int, error) {
	outFile, err := os.Create(outputPath)
	if err != nil {
		return 0, err
	}
	defer outFile.Close()

	zipWriter := zip.NewWriter(outFile)
	defer zipWriter.Close()

	fileCount := 0
	err = filepath.WalkDir(sourceDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}

		if rel == "." {
			return nil
		}

		if entry.IsDir() {
			return nil
		}

		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}

		info, err := entry.Info()
		if err != nil {
			return err
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(rel)
		header.Method = zip.Deflate

		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			return err
		}

		source, err := os.Open(path)
		if err != nil {
			return err
		}

		if _, err := io.Copy(writer, source); err != nil {
			source.Close()
			return err
		}

		if err := source.Close(); err != nil {
			return err
		}

		fileCount++
		return nil
	})

	if err != nil {
		return fileCount, err
	}

	return fileCount, nil
}
