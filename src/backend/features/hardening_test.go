package features

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestSanitizeRangeForFileWhitelist(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"1-3,5", "1-3_5"},
		{"1:5", "1-5"},
		{`1"; filename="evil`, "1_"},
		{"abc", "range"},
		{"", "range"},
	}
	for _, c := range cases {
		if got := sanitizeRangeForFile(c.in); got != c.want {
			t.Errorf("sanitizeRangeForFile(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSafeNoteNameWindowsReserved(t *testing.T) {
	for _, reserved := range []string{"CON", "con", "Nul", "COM1", "lpt9", "CON.backup"} {
		got := safeNoteName(reserved)
		if !strings.HasPrefix(got, "_") {
			t.Errorf("safeNoteName(%q) = %q, expected a reserved-name prefix", reserved, got)
		}
		// Sanitization must stay idempotent so validNoteID round-trips.
		if again := safeNoteName(got); again != got {
			t.Errorf("safeNoteName not idempotent: %q -> %q -> %q", reserved, got, again)
		}
	}
	if got := safeNoteName("Console notes"); got != "Console notes" {
		t.Errorf("safeNoteName mangled a non-reserved name: %q", got)
	}
}

func TestExtractBudgetFileLimit(t *testing.T) {
	b := &extractBudget{files: maxExtractFiles}
	if err := b.addFile(); err == nil {
		t.Error("expected file-count budget to reject file beyond the limit")
	}
}

func TestExtractBudgetByteLimit(t *testing.T) {
	b := &extractBudget{bytes: maxExtractBytes - 10}
	var sink bytes.Buffer
	if err := b.copy(&sink, io.LimitReader(neverEnding{}, 1024)); err == nil {
		t.Error("expected byte budget to reject data beyond the limit")
	}
}

// neverEnding is an io.Reader producing zeros forever.
type neverEnding struct{}

func (neverEnding) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}
