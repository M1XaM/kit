package features

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestBatchImagesReturnZip verifies that uploading several images to a
// single-image endpoint yields a ZIP with one output per input.
func TestBatchImagesReturnZip(t *testing.T) {
	req := multipartImageRequest(t, "files",
		map[string][]byte{
			"a.png": makeTestPNG(t, 40, 30),
			"b.png": makeTestPNG(t, 60, 20),
			"c.png": makeTestPNG(t, 10, 10),
		},
		map[string]string{"mode": "percent", "percent": "50"})
	rec := httptest.NewRecorder()
	HandleResizeImage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("content type = %q, want zip", ct)
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("invalid zip: %v", err)
	}
	if len(zr.File) != 3 {
		t.Fatalf("zip has %d files, want 3", len(zr.File))
	}
}

// TestSingleImageStillDirect ensures the single-file path still streams an
// image rather than a ZIP.
func TestSingleImageStillDirect(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"one.png": makeTestPNG(t, 20, 20)},
		map[string]string{"format": "png", "quality": "90"})
	rec := httptest.NewRecorder()
	HandleConvertImage(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("content type = %q, want image/png", ct)
	}
}

// TestEnhanceDefaults verifies the simplified one-click enhance works with no
// tuning parameters at all.
func TestEnhanceDefaults(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"noisy.png": makeTestPNG(t, 24, 24)}, nil)
	rec := httptest.NewRecorder()
	HandleEnhanceImage(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
}

// TestSaveRecordingWritesUnderData covers the recordings Save endpoint,
// including the duplicate-name suffix.
func TestSaveRecordingWritesUnderData(t *testing.T) {
	base := t.TempDir()
	dataBaseDirOverride = base
	t.Cleanup(func() { dataBaseDirOverride = "" })

	send := func() *httptest.ResponseRecorder {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		mw.WriteField("feature", "record-audio")
		fw, _ := mw.CreateFormFile("file", "take.webm")
		fw.Write([]byte("not really audio"))
		mw.Close()
		req := httptest.NewRequest(http.MethodPost, "/", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		rec := httptest.NewRecorder()
		HandleSaveRecording(rec, req)
		return rec
	}

	rec := send()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct{ Path string }
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response: %v", err)
	}
	if !strings.HasPrefix(resp.Path, filepath.Join(base, "data", "record-audio")) {
		t.Fatalf("saved outside data dir: %s", resp.Path)
	}
	if _, err := os.Stat(resp.Path); err != nil {
		t.Fatalf("file not written: %v", err)
	}

	// A second save with the same name must not overwrite the first.
	rec2 := send()
	var resp2 struct{ Path string }
	json.Unmarshal(rec2.Body.Bytes(), &resp2)
	if resp2.Path == resp.Path {
		t.Fatalf("second save overwrote the first: %s", resp2.Path)
	}
}

// TestSaveRecordingRejectsUnknownFeature keeps the write path allowlisted.
func TestSaveRecordingRejectsUnknownFeature(t *testing.T) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mw.WriteField("feature", "../etc")
	fw, _ := mw.CreateFormFile("file", "x")
	fw.Write([]byte("x"))
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rec := httptest.NewRecorder()
	HandleSaveRecording(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// TestNotesTrashFlow erases a note, confirms it left the list, and checks the
// 7-day purge.
func TestNotesTrashFlow(t *testing.T) {
	base := t.TempDir()
	notesBaseDirOverride = base
	dataBaseDirOverride = base
	t.Cleanup(func() { notesBaseDirOverride = ""; dataBaseDirOverride = "" })

	dir, err := notesDir()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "groceries.txt"), []byte("milk"), 0o644); err != nil {
		t.Fatal(err)
	}

	body := strings.NewReader(`{"id":"groceries"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	rec := httptest.NewRecorder()
	HandleTrashNote(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("trash status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "groceries.txt")); !os.IsNotExist(err) {
		t.Fatal("note still present after erase")
	}
	trashed := filepath.Join(dir, "trash", "groceries.txt")
	if _, err := os.Stat(trashed); err != nil {
		t.Fatalf("note not in trash: %v", err)
	}

	// Fresh trash entries survive a cleanup...
	CleanupNotesTrash()
	if _, err := os.Stat(trashed); err != nil {
		t.Fatal("fresh trash entry was purged")
	}
	// ...but entries older than 7 days are removed.
	old := time.Now().Add(-8 * 24 * time.Hour)
	os.Chtimes(trashed, old, old)
	CleanupNotesTrash()
	if _, err := os.Stat(trashed); !os.IsNotExist(err) {
		t.Fatal("expired trash entry was not purged")
	}
}

// TestYoutubeRejectsNonYoutubeURL ensures only YouTube hosts pass validation.
func TestYoutubeRejectsNonYoutubeURL(t *testing.T) {
	bad := []string{
		"https://example.com/watch?v=abc",
		"file:///etc/passwd",
		"https://evil.youtube.com.attacker.com/x",
		"ftp://youtube.com/x",
	}
	for _, u := range bad {
		if _, err := validYoutubeURL(u); err == nil {
			t.Errorf("URL %q was accepted", u)
		}
	}
	good := []string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ",
		"https://music.youtube.com/watch?v=abc",
	}
	for _, u := range good {
		if _, err := validYoutubeURL(u); err != nil {
			t.Errorf("URL %q was rejected: %v", u, err)
		}
	}
}
