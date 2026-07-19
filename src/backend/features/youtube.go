package features

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// YouTube Download shells out to yt-dlp. Releases bundle yt-dlp under the lib/
// folder next to the Kit binary (same place as the AI sidecars), so the user
// never has to install it — we resolve the bundled copy first and only fall
// back to a yt-dlp already on PATH for dev builds. Only YouTube URLs are
// accepted; the binary is never handed anything else.

const (
	ytMaxLinks = 10
	ytTimeout  = 60 * time.Minute
	ytFormMax  = 64 << 10 // request body is JSON with a handful of URLs
)

// ytAllowedHosts are the only hosts the downloader accepts.
var ytAllowedHosts = map[string]bool{
	"youtube.com":              true,
	"www.youtube.com":          true,
	"m.youtube.com":            true,
	"music.youtube.com":        true,
	"youtu.be":                 true,
	"www.youtu.be":             true,
	"youtube-nocookie.com":     true,
	"www.youtube-nocookie.com": true,
}

// ytQualityFormat maps the requested quality + mode to a yt-dlp format
// expression. mode: "both" (video with audio), "video" (no audio), "audio".
func ytQualityFormat(mode, quality string) []string {
	height := ""
	switch quality {
	case "2160", "1440", "1080", "720", "480", "360":
		height = quality
	}

	switch mode {
	case "audio":
		// Extract the best audio track; convert to mp3 when ffmpeg is present
		// (yt-dlp uses ffmpeg for post-processing).
		args := []string{"-f", "bestaudio/best"}
		if _, err := ffmpegPath(); err == nil {
			args = append(args, "-x", "--audio-format", "mp3", "--audio-quality", "0")
		}
		return args
	case "video":
		sel := "bestvideo"
		if height != "" {
			sel = fmt.Sprintf("bestvideo[height<=%s]", height)
		}
		// Same preference as "both" so a no-audio download is a playable file,
		// not a VP9/AV1 stream that shows as a black screen.
		return append([]string{"-f", sel + "/best"}, ytSortArgs(height)...)
	default: // both
		if _, err := ffmpegPath(); err == nil {
			sel := "bestvideo+bestaudio/best"
			if height != "" {
				sel = fmt.Sprintf("bestvideo[height<=%s]+bestaudio/best[height<=%s]", height, height)
			}
			// YouTube's outright "best" video is usually VP9/AV1; muxed into MP4
			// those play as audio-only — a black screen with sound — in browsers,
			// QuickTime and many players. ytSortArgs prefers H.264 + AAC so the
			// common case is a universally playable MP4; the explicit 1440p/2160p
			// options are VP9/AV1-only, so those keep their resolution and merge
			// into an MKV container (see ytMergeFormat), which plays them reliably.
			args := []string{"-f", sel}
			args = append(args, ytSortArgs(height)...)
			args = append(args, "--merge-output-format", ytMergeFormat(height))
			return args
		}
		// Without ffmpeg yt-dlp cannot merge separate streams; use the best
		// single (progressive) file instead. Progressive streams are H.264+AAC
		// MP4, so prefer an mp4 one — it always plays.
		sel := "best[ext=mp4]/best"
		if height != "" {
			sel = fmt.Sprintf("best[height<=%s][ext=mp4]/best[height<=%s]", height, height)
		}
		return []string{"-f", sel}
	}
}

// highResVP9 reports whether a requested height is one YouTube only serves as
// VP9/AV1 (no H.264). For these the user explicitly wants the resolution, so we
// must not let an H.264 preference downgrade them to 1080p.
func highResVP9(height string) bool {
	return height == "1440" || height == "2160"
}

// ytSortArgs returns yt-dlp's -S format sort. For the H.264-capable resolutions
// (best/1080p and below) we prefer H.264 video + AAC audio so the result is a
// universally playable MP4. For 1440p/2160p — which exist only as VP9/AV1 — we
// sort by resolution instead, so the user actually gets the resolution they
// asked for (the container then handles playability; see ytMergeFormat).
func ytSortArgs(height string) []string {
	if highResVP9(height) {
		return []string{"-S", "res,vcodec,acodec"}
	}
	return []string{"-S", "vcodec:h264,res,acodec:aac"}
}

// ytMergeFormat picks the output container for merged downloads: MP4 for the
// H.264 path (plays everywhere) and MKV for the high-res VP9/AV1 path, since MP4
// can't reliably hold those codecs (the symptom is a black screen with sound).
func ytMergeFormat(height string) string {
	if highResVP9(height) {
		return "mkv"
	}
	return "mp4"
}

// validYoutubeURL parses and validates one link.
func validYoutubeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("empty link")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return "", fmt.Errorf("%q is not a valid link", raw)
	}
	host := strings.ToLower(u.Hostname())
	if !ytAllowedHosts[host] {
		return "", fmt.Errorf("%q is not a YouTube link", raw)
	}
	return u.String(), nil
}

// HandleYoutubeDownload downloads one or more YouTube videos with yt-dlp.
//
// JSON body:
//
//	{
//	  "urls":    ["https://www.youtube.com/watch?v=..."],
//	  "mode":    "both" | "audio" | "video",
//	  "quality": "best" | "2160" | "1440" | "1080" | "720" | "480" | "360"
//	}
//
// One video streams straight back; several come back as a ZIP.
func HandleYoutubeDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ytBin, _, ok := findSidecar("yt-dlp")
	if !ok {
		http.Error(w, "yt-dlp was not found. It ships bundled with Kit, so this usually means the lib/ folder next to the Kit binary is missing — reinstall Kit, or install yt-dlp (https://github.com/yt-dlp/yt-dlp) and restart.", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		URLs    []string `json:"urls"`
		Mode    string   `json:"mode"`
		Quality string   `json:"quality"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, ytFormMax)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return
	}
	if len(req.URLs) == 0 {
		http.Error(w, "Add at least one YouTube link.", http.StatusBadRequest)
		return
	}
	if len(req.URLs) > ytMaxLinks {
		http.Error(w, fmt.Sprintf("Too many links. The limit is %d per request.", ytMaxLinks), http.StatusBadRequest)
		return
	}

	urls := make([]string, 0, len(req.URLs))
	for _, raw := range req.URLs {
		u, err := validYoutubeURL(raw)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		urls = append(urls, u)
	}

	outDir, err := os.MkdirTemp(tempRoot(), "kit-youtube-*")
	if err != nil {
		http.Error(w, "Failed to create workspace", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outDir)

	ctx, cancel := context.WithTimeout(r.Context(), ytTimeout)
	defer cancel()

	args := []string{
		"--no-playlist", // a watch link with &list= must not pull the playlist
		"--no-progress",
		"--restrict-filenames", // safe, ASCII-only output names
		"--max-downloads", fmt.Sprintf("%d", ytMaxLinks),
		"-o", filepath.Join(outDir, "%(title).150s [%(id)s].%(ext)s"),
	}
	args = append(args, ytQualityFormat(req.Mode, req.Quality)...)
	args = append(args, "--")
	args = append(args, urls...)

	cmd := hiddenCommandContext(ctx, ytBin, args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := runHeavyJob(ctx, cmd.Run); err != nil {
		// --max-downloads makes yt-dlp exit with code 101 even on success;
		// treat the run as failed only when nothing was produced.
		files, _ := collectFiles(outDir)
		if len(files) == 0 {
			msg := strings.TrimSpace(stderr.String())
			if len(msg) > 600 {
				msg = msg[len(msg)-600:]
			}
			if msg == "" {
				msg = err.Error()
			}
			fmt.Printf("yt-dlp failed: %v: %s\n", err, msg)
			http.Error(w, "Download failed: "+msg, http.StatusBadGateway)
			return
		}
	}

	files, err := collectFiles(outDir)
	if err != nil || len(files) == 0 {
		http.Error(w, "yt-dlp finished but produced no files.", http.StatusBadGateway)
		return
	}

	if len(files) == 1 {
		name := filepath.Base(files[0])
		if err := sendFile(w, files[0], name, contentTypeForExt(filepath.Ext(name))); err != nil {
			fmt.Printf("youtube send error: %v\n", err)
		}
		return
	}

	zipFile, err := os.CreateTemp(tempRoot(), "kit-youtube-*.zip")
	if err != nil {
		http.Error(w, "Failed to create archive", http.StatusInternalServerError)
		return
	}
	zipPath := zipFile.Name()
	defer os.Remove(zipPath)
	if err := writeFilesToZip(zipFile, files); err != nil {
		zipFile.Close()
		http.Error(w, "Failed to archive the downloads.", http.StatusInternalServerError)
		return
	}
	zipFile.Close()
	if err := sendFile(w, zipPath, "youtube_downloads.zip", "application/zip"); err != nil {
		fmt.Printf("youtube send error: %v\n", err)
	}
}
