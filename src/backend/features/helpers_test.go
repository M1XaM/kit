package features

import (
	"image/color"
	"path/filepath"
	"testing"
)

// These tests cover the small pure helpers that back the image, archive and
// metadata features. They need no external binaries, so they always run in the
// Docker test container and pin the format/extension/colour decisions every
// feature relies on.

func TestNormalizeCreateFormat(t *testing.T) {
	cases := map[string]string{
		"":       "zip",
		"zip":    "zip",
		"ZIP":    "zip",
		" tar ":  "tar",
		"tar.gz": "tar.gz",
		"tgz":    "tar.gz",
		"7z":     "7z",
		"rar":    "rar",
		"bogus":  "",
	}
	for in, want := range cases {
		if got := normalizeCreateFormat(in); got != want {
			t.Errorf("normalizeCreateFormat(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDetectArchiveFormat(t *testing.T) {
	cases := map[string]string{
		"backup.tar.gz":   "tar.gz",
		"backup.TGZ":      "tar.gz",
		"data.tar":        "tar",
		"photos.zip":      "zip",
		"bundle.7z":       "7z",
		"old.rar":         "rar",
		"single.gz":       "gz",
		"notanarchive.md": "",
	}
	for in, want := range cases {
		if got := detectArchiveFormat(in); got != want {
			t.Errorf("detectArchiveFormat(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestArchiveExtensionAndContentType(t *testing.T) {
	for _, format := range []string{"zip", "tar", "tar.gz", "7z", "rar", "gz"} {
		if archiveExtension(format) == "" {
			t.Errorf("archiveExtension(%q) returned empty extension", format)
		}
		if archiveContentType(format) == "application/octet-stream" {
			t.Errorf("archiveContentType(%q) fell through to the generic type", format)
		}
	}
	if got := archiveExtension("bogus"); got != "" {
		t.Errorf("archiveExtension(bogus) = %q, want empty", got)
	}
	if got := archiveContentType("bogus"); got != "application/octet-stream" {
		t.Errorf("archiveContentType(bogus) = %q, want octet-stream", got)
	}
}

func TestFormatNeeds7z(t *testing.T) {
	for _, f := range []string{"zip", "tar", "tar.gz", "gz"} {
		if formatNeeds7z(f) {
			t.Errorf("formatNeeds7z(%q) = true, want false", f)
		}
	}
	for _, f := range []string{"7z", "rar"} {
		if !formatNeeds7z(f) {
			t.Errorf("formatNeeds7z(%q) = false, want true", f)
		}
	}
}

func TestUniqueFileName(t *testing.T) {
	used := map[string]int{}
	if got := uniqueFileName("report.pdf", used); got != "report.pdf" {
		t.Fatalf("first name = %q, want report.pdf", got)
	}
	if got := uniqueFileName("report.pdf", used); got != "report-2.pdf" {
		t.Fatalf("collision name = %q, want report-2.pdf", got)
	}
	if got := uniqueFileName("report.pdf", used); got != "report-3.pdf" {
		t.Fatalf("third name = %q, want report-3.pdf", got)
	}
}

func TestSafeArchivePath(t *testing.T) {
	base := filepath.Join("workspace", "out")
	// Traversal attempts and empty names must be rejected.
	for _, bad := range []string{"../escape", "..", "../../etc/passwd", ".", ""} {
		if _, err := safeArchivePath(base, bad); err == nil {
			t.Errorf("safeArchivePath(%q) accepted a traversal/empty path", bad)
		}
	}
	// A normal nested entry resolves under the base dir.
	got, err := safeArchivePath(base, "sub/file.txt")
	if err != nil {
		t.Fatalf("safeArchivePath(sub/file.txt) errored: %v", err)
	}
	want := filepath.Join(base, "sub", "file.txt")
	if got != want {
		t.Errorf("safeArchivePath(sub/file.txt) = %q, want %q", got, want)
	}
}

func TestNormalizeOutputFormat(t *testing.T) {
	cases := []struct {
		requested, src, want string
	}{
		{"jpg", "png", "jpeg"},
		{"jpeg", "png", "jpeg"},
		{"png", "jpeg", "png"},
		{"gif", "png", "gif"},
		{"tiff", "png", "tiff"},
		{"tif", "png", "tiff"},
		{"keep", "jpeg", "jpeg"}, // keep falls back to source
		{"", "png", "png"},       // empty falls back to source
		{"webp", "webp", "png"},  // unknown re-encodes as png
	}
	for _, c := range cases {
		if got := normalizeOutputFormat(c.requested, c.src); got != c.want {
			t.Errorf("normalizeOutputFormat(%q,%q) = %q, want %q", c.requested, c.src, got, c.want)
		}
	}
}

func TestImageContentType(t *testing.T) {
	cases := map[string][2]string{
		"jpeg":  {"image/jpeg", "jpg"},
		"gif":   {"image/gif", "gif"},
		"bmp":   {"image/bmp", "bmp"},
		"tiff":  {"image/tiff", "tiff"},
		"png":   {"image/png", "png"},
		"weird": {"image/png", "png"},
	}
	for format, want := range cases {
		ct, ext := imageContentType(format)
		if ct != want[0] || ext != want[1] {
			t.Errorf("imageContentType(%q) = (%q,%q), want (%q,%q)", format, ct, ext, want[0], want[1])
		}
	}
}

func TestClampDim(t *testing.T) {
	if got := clampDim(0); got != 1 {
		t.Errorf("clampDim(0) = %d, want 1", got)
	}
	if got := clampDim(-5); got != 1 {
		t.Errorf("clampDim(-5) = %d, want 1", got)
	}
	if got := clampDim(maxImageDimension + 100); got != maxImageDimension {
		t.Errorf("clampDim(over max) = %d, want %d", got, maxImageDimension)
	}
	if got := clampDim(640); got != 640 {
		t.Errorf("clampDim(640) = %d, want 640", got)
	}
}

func TestParseHexColor(t *testing.T) {
	fallback := color.NRGBA{R: 1, G: 2, B: 3, A: 4}
	// Empty and wrong-length inputs return the fallback unchanged. (Invalid hex
	// digits in a correctly sized string decode to 0 rather than the fallback.)
	for _, bad := range []string{"", "#12", "#12345"} {
		if got := parseHexColor(bad, fallback); got != fallback {
			t.Errorf("parseHexColor(%q) = %+v, want fallback", bad, got)
		}
	}
	if got := parseHexColor("#fff", fallback); got != (color.NRGBA{R: 255, G: 255, B: 255, A: 255}) {
		t.Errorf("parseHexColor(#fff) = %+v, want white", got)
	}
	if got := parseHexColor("ff0000", fallback); got != (color.NRGBA{R: 255, G: 0, B: 0, A: 255}) {
		t.Errorf("parseHexColor(ff0000) = %+v, want red", got)
	}
	if got := parseHexColor("#0000ff80", fallback); got != (color.NRGBA{R: 0, G: 0, B: 255, A: 128}) {
		t.Errorf("parseHexColor(#0000ff80) = %+v, want translucent blue", got)
	}
}

func TestFormatFromName(t *testing.T) {
	cases := map[string]string{
		"a.JPG":  "jpeg",
		"a.jpeg": "jpeg",
		"a.gif":  "gif",
		"a.bmp":  "bmp",
		"a.tiff": "tiff",
		"a.tif":  "tiff",
		"a.png":  "png",
		"noext":  "png",
		"a.webp": "png",
	}
	for in, want := range cases {
		if got := formatFromName(in); got != want {
			t.Errorf("formatFromName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMetadataKind(t *testing.T) {
	cases := []struct {
		name, contentType, want string
	}{
		{"file.pdf", "", "pdf"},
		{"photo.JPG", "", "image"},
		{"song.mp3", "", "audio"},
		{"clip.mp4", "", "audio"},
		{"unknown", "image/png", "image"},
		{"unknown", "audio/mpeg", "audio"},
		{"unknown", "video/mp4", "audio"},
		{"unknown", "application/pdf", "pdf"},
		{"unknown", "text/plain", "other"},
	}
	for _, c := range cases {
		if got := metadataKind(c.name, c.contentType); got != c.want {
			t.Errorf("metadataKind(%q,%q) = %q, want %q", c.name, c.contentType, got, c.want)
		}
	}
}
