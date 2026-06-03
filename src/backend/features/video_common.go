package features

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Video tools shell out to ffmpeg/ffprobe. They are not bundled with Kit, so a
// missing binary surfaces a clear, actionable error instead of a vague 500.

// ffmpegTimeout caps a single transcode so a stuck process can't hang forever.
const ffmpegTimeout = 30 * time.Minute

// maxVideoUploadBytes mirrors the multipart memory threshold; anything bigger
// spills to a temp file on disk rather than being held in memory.
const videoFormMemory = 32 << 20

func ffmpegPath() (string, error) {
	return exec.LookPath("ffmpeg")
}

func ffprobePath() (string, error) {
	return exec.LookPath("ffprobe")
}

// requireFFmpeg reports a friendly error to the client when ffmpeg is absent.
func requireFFmpeg(w http.ResponseWriter) (string, bool) {
	bin, err := ffmpegPath()
	if err != nil {
		http.Error(w, "ffmpeg is required for video and audio conversion but was not found on your system. Install ffmpeg, then restart Kit.", http.StatusServiceUnavailable)
		return "", false
	}
	return bin, true
}

// saveUploadToTemp streams an uploaded file to a temp file, preserving its
// extension so ffmpeg can infer the input format. The caller must remove it.
func saveUploadToTemp(file multipart.File, originalName, prefix string) (string, error) {
	ext := strings.ToLower(filepath.Ext(originalName))
	ext = sanitizeExt(ext)
	tmp, err := os.CreateTemp("", prefix+"-*"+ext)
	if err != nil {
		return "", err
	}
	defer tmp.Close()
	if _, err := io.Copy(tmp, file); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return tmp.Name(), nil
}

// sanitizeExt keeps only a short, safe alphanumeric extension (with the dot).
func sanitizeExt(ext string) string {
	if ext == "" || ext == "." {
		return ""
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	for _, r := range ext[1:] {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return ""
		}
	}
	if len(ext) > 6 {
		return ""
	}
	return ext
}

// runFFmpeg executes ffmpeg with the given args, always overwriting output.
// Stderr is captured so failures can be logged server-side.
func runFFmpeg(bin string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), ffmpegTimeout)
	defer cancel()

	full := append([]string{"-y", "-hide_banner", "-loglevel", "error"}, args...)
	cmd := exec.CommandContext(ctx, bin, full...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("ffmpeg failed: %s", msg)
	}
	return nil
}

// probeDuration returns the media duration in seconds, or 0 if unknown.
func probeDuration(path string) float64 {
	bin, err := ffprobePath()
	if err != nil {
		return 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	val, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil {
		return 0
	}
	return val
}

// probeHasAudio reports whether the file contains at least one audio stream.
func probeHasAudio(path string) bool {
	bin, err := ffprobePath()
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin,
		"-v", "error",
		"-select_streams", "a",
		"-show_entries", "stream=index",
		"-of", "csv=p=0",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) != ""
}

// probeResolution returns the first video stream's width and height, or 0,0.
func probeResolution(path string) (int, int) {
	bin, err := ffprobePath()
	if err != nil {
		return 0, 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin,
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height",
		"-of", "csv=s=x:p=0",
		path,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, 0
	}
	parts := strings.Split(strings.TrimSpace(string(out)), "x")
	if len(parts) != 2 {
		return 0, 0
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil {
		return 0, 0
	}
	return w, h
}

// sendFile writes a finished file back to the client as an attachment.
func sendFile(w http.ResponseWriter, path, downloadName, contentType string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	if info, statErr := f.Stat(); statErr == nil {
		w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, downloadName))
	_, err = io.Copy(w, f)
	return err
}

// videoCodecArgs returns sensible encoder flags for a target container so each
// tool produces a valid file regardless of the chosen output extension.
func videoCodecArgs(ext string) []string {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "webm":
		return []string{"-c:v", "libvpx-vp9", "-b:v", "0", "-c:a", "libopus"}
	case "ogv":
		return []string{"-c:v", "libtheora", "-c:a", "libvorbis"}
	default: // mp4, mov, mkv, m4v, ...
		return []string{"-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"}
	}
}

// contentTypeForExt maps an extension to a reasonable Content-Type.
func contentTypeForExt(ext string) string {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "mp4", "m4v":
		return "video/mp4"
	case "webm":
		return "video/webm"
	case "mkv":
		return "video/x-matroska"
	case "mov":
		return "video/quicktime"
	case "avi":
		return "video/x-msvideo"
	case "gif":
		return "image/gif"
	case "ogv":
		return "video/ogg"
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "ogg":
		return "audio/ogg"
	case "m4a", "aac":
		return "audio/mp4"
	case "flac":
		return "audio/flac"
	case "opus":
		return "audio/opus"
	default:
		return "application/octet-stream"
	}
}

// parseSeconds parses a non-negative duration in seconds from a form value.
// Accepts plain seconds ("12.5") or clock form ("mm:ss", "hh:mm:ss").
func parseSeconds(value string) (float64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if strings.Contains(value, ":") {
		parts := strings.Split(value, ":")
		if len(parts) > 3 {
			return 0, false
		}
		total := 0.0
		for _, p := range parts {
			n, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
			if err != nil || n < 0 {
				return 0, false
			}
			total = total*60 + n
		}
		return total, true
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

// clampInt parses an integer form value and clamps it to [min, max]. ok is
// false when the field is empty or non-numeric.
func clampInt(value string, min, max int) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	if n < min {
		n = min
	}
	if n > max {
		n = max
	}
	return n, true
}
