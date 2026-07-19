package features

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"local-tools-hub/backend/features/shared"
)

type storedFile struct {
	Path string
	Name string
	Size int64
}

func normalizeCreateFormat(raw string) string {
	format := strings.ToLower(strings.TrimSpace(raw))
	if format == "" {
		return "zip"
	}

	switch format {
	case "zip", "tar", "tar.gz", "7z", "rar":
		return format
	case "tgz":
		return "tar.gz"
	default:
		return ""
	}
}

func detectArchiveFormat(filename string) string {
	name := strings.ToLower(strings.TrimSpace(filename))
	switch {
	case strings.HasSuffix(name, ".tar.gz") || strings.HasSuffix(name, ".tgz"):
		return "tar.gz"
	case strings.HasSuffix(name, ".tar"):
		return "tar"
	case strings.HasSuffix(name, ".zip"):
		return "zip"
	case strings.HasSuffix(name, ".7z"):
		return "7z"
	case strings.HasSuffix(name, ".rar"):
		return "rar"
	case strings.HasSuffix(name, ".gz"):
		return "gz"
	default:
		return ""
	}
}

func archiveExtension(format string) string {
	switch format {
	case "zip":
		return ".zip"
	case "tar":
		return ".tar"
	case "tar.gz":
		return ".tar.gz"
	case "7z":
		return ".7z"
	case "rar":
		return ".rar"
	case "gz":
		return ".gz"
	default:
		return ""
	}
}

func archiveContentType(format string) string {
	switch format {
	case "zip":
		return "application/zip"
	case "tar":
		return "application/x-tar"
	case "tar.gz", "gz":
		return "application/gzip"
	case "7z":
		return "application/x-7z-compressed"
	case "rar":
		return "application/vnd.rar"
	default:
		return "application/octet-stream"
	}
}

func formatNeeds7z(format string) bool {
	switch format {
	case "zip", "tar", "tar.gz", "gz":
		return false
	default:
		return true
	}
}

func storeMultipartFiles(fileHeaders []*multipart.FileHeader, dir string) ([]storedFile, error) {
	usedNames := make(map[string]int, len(fileHeaders))
	stored := make([]storedFile, 0, len(fileHeaders))

	for _, header := range fileHeaders {
		fileInfo, err := storeMultipartFile(header, dir, usedNames)
		if err != nil {
			return nil, err
		}
		stored = append(stored, fileInfo)
	}

	return stored, nil
}

func storeMultipartFile(header *multipart.FileHeader, dir string, used map[string]int) (storedFile, error) {
	source, err := header.Open()
	if err != nil {
		return storedFile{}, err
	}
	defer source.Close()

	safeName := uniqueFileName(header.Filename, used)
	targetPath := filepath.Join(dir, safeName)

	target, err := os.Create(targetPath)
	if err != nil {
		return storedFile{}, err
	}
	defer target.Close()

	if _, err := io.Copy(target, source); err != nil {
		return storedFile{}, err
	}

	return storedFile{Path: targetPath, Name: safeName, Size: header.Size}, nil
}

func uniqueFileName(original string, used map[string]int) string {
	base := shared.SafeFileName(original)
	if base == "" {
		base = "file"
	}

	if used[base] == 0 {
		used[base] = 1
		return base
	}

	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", stem, i, ext)
		if used[candidate] == 0 {
			used[candidate] = 1
			return candidate
		}
	}
}

func find7zBinary() (string, error) {
	candidates := []string{"7z", "7za", "7zr"}
	for _, candidate := range candidates {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", errors.New("7z not found")
}

func extractWith7z(archivePath, destDir string) error {
	binary, err := find7zBinary()
	if err != nil {
		return err
	}

	cmd := hiddenCommand(binary, "x", "-y", "-o"+destDir, "--", archivePath)
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("7z extraction failed: %s", message)
	}
	return nil
}

func createWith7z(format, outputPath, inputDir string, inputNames []string) error {
	binary, err := find7zBinary()
	if err != nil {
		return err
	}

	// "--" stops switch parsing so an uploaded filename starting with "-" can
	// never be interpreted as a 7z option.
	args := []string{"a", "-y", "-t" + format, outputPath, "--"}
	args = append(args, inputNames...)

	cmd := hiddenCommand(binary, args...)
	cmd.Dir = inputDir
	output, err := cmd.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("7z archive creation failed: %s", message)
	}

	return nil
}
