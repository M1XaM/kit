package shared

import (
	"strings"
	"testing"
)

func TestSafeFileBase(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"photo.png", "photo"},
		{"/tmp/dir/photo.png", "photo"},
		{`C:\Users\me\photo.png`, "photo"},
		{`..\..\evil.png`, "evil"},
		{"", "output"},
		{".", "output"},
		{"...", "output"},
		{`a"b.png`, "ab"},
		{"new\nline.png", "newline"},
	}
	for _, c := range cases {
		if got := SafeFileBase(c.in); got != c.want {
			t.Errorf("SafeFileBase(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSafeFileName(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"doc.pdf", "doc.pdf"},
		{"/tmp/dir/doc.pdf", "doc.pdf"},
		{`C:\Users\me\doc.pdf`, "doc.pdf"},
		{"", "output.pdf"},
		{`evil";x=y.pdf`, "evil;x=y.pdf"},
	}
	for _, c := range cases {
		if got := SafeFileName(c.in); got != c.want {
			t.Errorf("SafeFileName(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestSafeFileNamesNeverBreakHeaders(t *testing.T) {
	hostile := []string{
		"a\r\nSet-Cookie: x=y.pdf",
		`a"; filename="evil.exe`,
		string([]byte{0x00, 0x01}) + ".pdf",
	}
	for _, h := range hostile {
		for _, got := range []string{SafeFileBase(h), SafeFileName(h)} {
			if strings.ContainsAny(got, "\"\r\n\x00") {
				t.Errorf("sanitized name still contains header-breaking chars: %q -> %q", h, got)
			}
		}
	}
}
