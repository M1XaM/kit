package shared

import (
	"path/filepath"
	"strings"
)

// stripUnsafe removes characters that would corrupt a Content-Disposition
// header or produce an awkward filename on at least one supported OS:
// control characters, double quotes and path separators.
func stripUnsafe(name string) string {
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		switch {
		case r < 0x20 || r == 0x7f: // control chars
		case r == '"' || r == '\\' || r == '/':
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

// baseName returns the last path element of name, treating both '/' and '\'
// as separators — browsers on Windows may submit full paths with backslashes,
// which filepath.Base would not split on a non-Windows server.
func baseName(name string) string {
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	return strings.TrimSpace(name)
}

// truncate caps the filename length so absurdly long upload names can't blow
// past filesystem limits when the result is used to build output names.
func truncate(name string, max int) string {
	runes := []rune(name)
	if len(runes) <= max {
		return name
	}
	return string(runes[:max])
}

// SafeFileBase returns a sanitized filename base (no extension, no path, no
// header-breaking characters) suitable for building download names.
func SafeFileBase(name string) string {
	base := stripUnsafe(baseName(name))
	base = strings.TrimSuffix(base, filepath.Ext(base))
	base = strings.Trim(base, ". ")
	if base == "" {
		return "output"
	}
	return truncate(base, 120)
}

// SafeFileName returns a sanitized filename (with extension) safe to use in a
// Content-Disposition header or as an on-disk name inside a temp workspace.
func SafeFileName(name string) string {
	base := stripUnsafe(baseName(name))
	base = strings.Trim(base, ". ")
	if base == "" {
		return "output.pdf"
	}
	return truncate(base, 150)
}
