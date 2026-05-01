package shared

import (
	"path/filepath"
	"strings"
)

func SafeFileBase(name string) string {
	base := strings.TrimSpace(filepath.Base(name))
	if base == "." || base == "/" || base == "" {
		return "output"
	}
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func SafeFileName(name string) string {
	base := strings.TrimSpace(filepath.Base(name))
	if base == "." || base == "/" || base == "" {
		return "output.pdf"
	}
	return base
}
