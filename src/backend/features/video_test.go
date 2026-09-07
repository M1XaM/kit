package features

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// makeTestVideo renders a short test clip with ffmpeg, skipping the test when
// ffmpeg is unavailable in the environment.
func makeTestVideo(t *testing.T) []byte {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed; skipping video handler test")
	}
	tmp, err := os.CreateTemp("", "vtest-*.mp4")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	tmp.Close()
	defer os.Remove(tmp.Name())

	cmd := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc=duration=6:size=320x240:rate=24",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=6",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
		tmp.Name())
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("make test video: %v: %s", err, out)
	}
	data, err := os.ReadFile(tmp.Name())
	if err != nil {
		t.Fatalf("read test video: %v", err)
	}
	return data
}

func videoRequest(t *testing.T, data []byte, name string, fields map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	part.Write(data)
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestHandleTrimVideo(t *testing.T) {
	data := makeTestVideo(t)
	rec := httptest.NewRecorder()
	HandleTrimVideo(rec, videoRequest(t, data, "in.mp4", map[string]string{"start": "1", "end": "3"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() == 0 {
		t.Fatal("empty trimmed output")
	}
}

func TestHandleConvertVideoWebm(t *testing.T) {
	data := makeTestVideo(t)
	rec := httptest.NewRecorder()
	HandleConvertVideo(rec, videoRequest(t, data, "in.mp4", map[string]string{"format": "webm"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "video/webm" {
		t.Fatalf("content-type = %q", ct)
	}
}

func TestHandleResizeVideo(t *testing.T) {
	data := makeTestVideo(t)
	rec := httptest.NewRecorder()
	HandleResizeVideo(rec, videoRequest(t, data, "in.mp4", map[string]string{"width": "160"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
}

func TestHandleSplitVideoParts(t *testing.T) {
	data := makeTestVideo(t)
	rec := httptest.NewRecorder()
	HandleSplitVideo(rec, videoRequest(t, data, "in.mp4", map[string]string{"mode": "parts", "parts": "3"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	if len(zr.File) < 2 {
		t.Fatalf("expected multiple clips, got %d", len(zr.File))
	}
}

// makeTestAudio renders a short MP3 with ffmpeg.
func makeTestAudio(t *testing.T) []byte {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed; skipping audio handler test")
	}
	tmp, err := os.CreateTemp("", "atest-*.mp3")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	tmp.Close()
	defer os.Remove(tmp.Name())

	cmd := exec.Command("ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=3",
		"-ar", "44100", "-b:a", "192k", tmp.Name())
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("make test audio: %v: %s", err, out)
	}
	data, err := os.ReadFile(tmp.Name())
	if err != nil {
		t.Fatalf("read test audio: %v", err)
	}
	return data
}

func TestHandleAdjustAudio(t *testing.T) {
	data := makeTestAudio(t)
	rec := httptest.NewRecorder()
	HandleAdjustAudio(rec, videoRequest(t, data, "in.mp3", map[string]string{"bitrate": "96", "sampleRate": "22050"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() == 0 {
		t.Fatal("empty adjusted output")
	}

	// Confirm the sample rate was actually applied.
	out, err := os.CreateTemp("", "adjusted-*.mp3")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	defer os.Remove(out.Name())
	out.Write(rec.Body.Bytes())
	out.Close()

	probe := exec.Command("ffprobe", "-v", "error", "-select_streams", "a:0",
		"-show_entries", "stream=sample_rate", "-of", "default=nk=1:nw=1", out.Name())
	probed, err := probe.Output()
	if err != nil {
		t.Fatalf("ffprobe: %v", err)
	}
	if got := strings.TrimSpace(string(probed)); got != "22050" {
		t.Fatalf("sample rate = %q, want 22050", got)
	}
}

func TestAdjustAudioRequiresAParam(t *testing.T) {
	data := makeTestAudio(t)
	rec := httptest.NewRecorder()
	HandleAdjustAudio(rec, videoRequest(t, data, "in.mp3", map[string]string{}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// multiVideoRequest builds a POST with several "file" parts in order.
func multiVideoRequest(t *testing.T, clips [][]byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for i, data := range clips {
		part, err := mw.CreateFormFile("file", "clip"+string(rune('0'+i))+".mp4")
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		part.Write(data)
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestHandleMergeVideo(t *testing.T) {
	a := makeTestVideo(t)
	b := makeTestVideo(t)
	rec := httptest.NewRecorder()
	HandleMergeVideo(rec, multiVideoRequest(t, [][]byte{a, b}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}

	// The merged clip should be roughly the sum of the two ~6s inputs.
	out, err := os.CreateTemp("", "merged-*.mp4")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	defer os.Remove(out.Name())
	out.Write(rec.Body.Bytes())
	out.Close()

	probe := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration",
		"-of", "default=nk=1:nw=1", out.Name())
	probed, err := probe.Output()
	if err != nil {
		t.Fatalf("ffprobe: %v", err)
	}
	dur, err := strconv.ParseFloat(strings.TrimSpace(string(probed)), 64)
	if err != nil {
		t.Fatalf("parse duration %q: %v", probed, err)
	}
	if dur < 10 {
		t.Fatalf("merged duration = %.2fs, expected ~12s", dur)
	}
}

func TestMergeVideoRequiresTwo(t *testing.T) {
	a := makeTestVideo(t)
	rec := httptest.NewRecorder()
	HandleMergeVideo(rec, multiVideoRequest(t, [][]byte{a}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestTrimVideoRejectsBadRange(t *testing.T) {
	data := makeTestVideo(t)
	rec := httptest.NewRecorder()
	HandleTrimVideo(rec, videoRequest(t, data, "in.mp4", map[string]string{"start": "5", "end": "2"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

// ffmpeg reads -threads per stage, so the cap has to sit both ahead of -i (the
// decoder) and ahead of the output file (the encoder, which is the expensive
// half). Without the second one a transcode still claims every core.
func TestWithEncoderThreadsInsertsBeforeOutput(t *testing.T) {
	args := []string{"-i", "in.mp4", "-c:v", "libx264", "-crf", "23", "out.mp4"}
	before := strings.Join(args, " ")
	got := withEncoderThreads(args)

	if len(got) != len(args)+2 {
		t.Fatalf("withEncoderThreads returned %d args, want %d: %v", len(got), len(args)+2, got)
	}
	if got[len(got)-1] != "out.mp4" {
		t.Errorf("the output path is no longer last: %v", got)
	}
	if got[len(got)-3] != "-threads" {
		t.Errorf("-threads is not immediately before the output: %v", got)
	}
	if n, err := strconv.Atoi(got[len(got)-2]); err != nil || n < 1 {
		t.Errorf("thread count %q is not a positive number", got[len(got)-2])
	}
	// The caller's slice must not be rewritten underneath it.
	if after := strings.Join(args, " "); after != before {
		t.Errorf("withEncoderThreads mutated its input: %q became %q", before, after)
	}
}

// Arguments that don't end in an output path are left exactly as they are,
// rather than having -threads spliced somewhere ffmpeg won't understand it.
func TestWithEncoderThreadsLeavesOtherShapesAlone(t *testing.T) {
	for _, args := range [][]string{
		nil,
		{},
		{"-i", "in.mp4", "-f", "null", "-"},
		{"-version"},
	} {
		got := withEncoderThreads(args)
		if len(got) != len(args) {
			t.Errorf("withEncoderThreads(%v) = %v, want it unchanged", args, got)
		}
	}
}
