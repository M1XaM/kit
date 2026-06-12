package features

import (
	"os"
	"path/filepath"
)

// dataBaseDirOverride redirects data storage in tests.
var dataBaseDirOverride = ""

// dataDir resolves (and creates) a folder under data/ next to the installed
// binary, falling back to the working directory for dev builds run via
// `go run`. Notes, saved recordings and downloaded OCR models all live there
// so users can browse and back them up with any tool.
func dataDir(parts ...string) (string, error) {
	base := ""
	if dataBaseDirOverride != "" {
		base = dataBaseDirOverride
	} else if exe, err := os.Executable(); err == nil {
		base = filepath.Dir(exe)
	} else if wd, err := os.Getwd(); err == nil {
		base = wd
	} else {
		return "", err
	}
	dir := filepath.Join(append([]string{base, "data"}, parts...)...)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}
