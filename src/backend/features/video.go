package features

import (
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Video and audio tools that re-encode media run on the Go backend via ffmpeg.
// Heavy transcoding is impractical in the browser without large WASM bundles,
// so — like the image tools — the work happens locally on the server side.

// getUploadedMedia pulls the uploaded file, accepting a few common field names
// so the same handlers work no matter which form sent the request.
func getUploadedMedia(r *http.Request) (multipart.File, *multipart.FileHeader, error) {
	for _, name := range []string{"file", "video", "audio", "image"} {
		if file, header, err := r.FormFile(name); err == nil {
			return file, header, nil
		}
	}
	return nil, nil, fmt.Errorf("no file uploaded")
}

// prepareMediaUpload parses the form and stores the upload in a temp file.
// On error it has already written an HTTP response. The caller must remove the
// returned path.
func prepareMediaUpload(w http.ResponseWriter, r *http.Request, prefix string) (path string, header *multipart.FileHeader, ok bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return "", nil, false
	}
	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse upload", http.StatusBadRequest)
		return "", nil, false
	}
	file, hdr, err := getUploadedMedia(r)
	if err != nil {
		http.Error(w, "A file is required", http.StatusBadRequest)
		return "", nil, false
	}
	defer file.Close()

	tmpPath, err := saveUploadToTemp(file, hdr.Filename, prefix)
	if err != nil {
		http.Error(w, "Failed to store upload", http.StatusInternalServerError)
		return "", nil, false
	}
	return tmpPath, hdr, true
}

// inputExt returns the lowercased, sanitized extension of the original upload,
// falling back to the provided default when missing/unsafe.
func inputExt(name, fallback string) string {
	ext := sanitizeExt(strings.ToLower(filepath.Ext(name)))
	if ext == "" {
		return fallback
	}
	return ext
}

// HandleTrimVideo trims a video to [start, end] without re-encoding (stream copy).
func HandleTrimVideo(w http.ResponseWriter, r *http.Request) {
	trimMedia(w, r, ".mp4")
}

// HandleTrimAudio trims an audio clip to [start, end] without re-encoding.
func HandleTrimAudio(w http.ResponseWriter, r *http.Request) {
	trimMedia(w, r, ".mp3")
}

var allowedSampleRates = map[int]bool{
	8000: true, 11025: true, 16000: true, 22050: true,
	32000: true, 44100: true, 48000: true, 96000: true,
}

// audioCodecArgs returns the encoder flags for a target audio container and
// whether the codec is lossy (i.e. honors a target bitrate).
func audioCodecArgs(ext string) (args []string, lossy bool) {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "wav":
		return []string{"-c:a", "pcm_s16le"}, false
	case "flac":
		return []string{"-c:a", "flac"}, false
	case "ogg":
		return []string{"-c:a", "libvorbis"}, true
	case "opus":
		return []string{"-c:a", "libopus"}, true
	case "m4a", "aac", "mp4":
		return []string{"-c:a", "aac"}, true
	default: // mp3 and anything else
		return []string{"-c:a", "libmp3lame"}, true
	}
}

// HandleAdjustAudio re-encodes an audio file with a new bitrate and/or sample
// rate. Bitrate only applies to lossy formats; sample rate applies to all.
func HandleAdjustAudio(w http.ResponseWriter, r *http.Request) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	inPath, header, ok := prepareMediaUpload(w, r, "adjust-in")
	if !ok {
		return
	}
	defer os.Remove(inPath)

	bitrate, hasBitrate := clampInt(r.FormValue("bitrate"), 8, 320)
	sampleRate, hasSampleRate := clampInt(r.FormValue("sampleRate"), 8000, 192000)
	if hasSampleRate && !allowedSampleRates[sampleRate] {
		http.Error(w, "Unsupported sample rate.", http.StatusBadRequest)
		return
	}
	if !hasBitrate && !hasSampleRate {
		http.Error(w, "Choose a bitrate and/or sample rate to apply.", http.StatusBadRequest)
		return
	}

	ext := inputExt(header.Filename, ".mp3")
	codec, lossy := audioCodecArgs(ext)

	args := []string{"-i", inPath, "-vn"}
	args = append(args, codec...)
	if hasSampleRate {
		args = append(args, "-ar", fmt.Sprintf("%d", sampleRate))
	}
	if hasBitrate && lossy {
		args = append(args, "-b:a", fmt.Sprintf("%dk", bitrate))
	}

	outPath, err := os.CreateTemp(tempRoot(), "adjust-out-*"+ext)
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath.Close()
	defer os.Remove(outPath.Name())
	args = append(args, outPath.Name())

	if err := runFFmpeg(bin, args...); err != nil {
		fmt.Printf("adjust audio error: %v\n", err)
		http.Error(w, "Failed to adjust audio.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileBase(header.Filename) + "_adjusted" + ext
	if err := sendFile(w, outPath.Name(), name, contentTypeForExt(ext)); err != nil {
		fmt.Printf("adjust audio send error: %v\n", err)
	}
}

func trimMedia(w http.ResponseWriter, r *http.Request, fallbackExt string) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	inPath, header, ok := prepareMediaUpload(w, r, "trim-in")
	if !ok {
		return
	}
	defer os.Remove(inPath)

	start, hasStart := parseSeconds(r.FormValue("start"))
	if !hasStart {
		start = 0
	}
	end, hasEnd := parseSeconds(r.FormValue("end"))
	if !hasEnd {
		http.Error(w, "An end time is required (seconds or mm:ss)", http.StatusBadRequest)
		return
	}
	if end <= start {
		http.Error(w, "End time must be greater than start time", http.StatusBadRequest)
		return
	}
	duration := end - start

	ext := inputExt(header.Filename, fallbackExt)
	outPath, err := os.CreateTemp(tempRoot(), "trim-out-*"+ext)
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath.Close()
	defer os.Remove(outPath.Name())

	args := []string{
		"-ss", trimNumber(start),
		"-i", inPath,
		"-t", trimNumber(duration),
		"-c", "copy",
		outPath.Name(),
	}
	if err := runFFmpeg(bin, args...); err != nil {
		fmt.Printf("trim error: %v\n", err)
		http.Error(w, "Failed to trim media. Check the start/end times.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileBase(header.Filename) + "_trimmed" + ext
	if err := sendFile(w, outPath.Name(), name, contentTypeForExt(ext)); err != nil {
		fmt.Printf("trim send error: %v\n", err)
	}
}

// HandleResizeVideo rescales a video to the requested width/height (either may
// be omitted to preserve aspect ratio). Dimensions are forced to even values
// so common encoders accept them.
func HandleResizeVideo(w http.ResponseWriter, r *http.Request) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	inPath, header, ok := prepareMediaUpload(w, r, "resize-in")
	if !ok {
		return
	}
	defer os.Remove(inPath)

	width, hasW := clampInt(r.FormValue("width"), 16, 7680)
	height, hasH := clampInt(r.FormValue("height"), 16, 4320)
	if !hasW && !hasH {
		http.Error(w, "Provide a width and/or height", http.StatusBadRequest)
		return
	}

	var scale string
	switch {
	case hasW && hasH:
		scale = fmt.Sprintf("scale=trunc(%d/2)*2:trunc(%d/2)*2", width, height)
	case hasW:
		scale = fmt.Sprintf("scale=trunc(%d/2)*2:-2", width)
	default:
		scale = fmt.Sprintf("scale=-2:trunc(%d/2)*2", height)
	}

	ext := inputExt(header.Filename, ".mp4")
	outPath, err := os.CreateTemp(tempRoot(), "resize-out-*"+ext)
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath.Close()
	defer os.Remove(outPath.Name())

	args := []string{"-i", inPath, "-vf", scale}
	args = append(args, videoOnlyCodec(ext)...)
	args = append(args, "-c:a", "copy", outPath.Name())
	if err := runFFmpeg(bin, args...); err != nil {
		fmt.Printf("resize error: %v\n", err)
		http.Error(w, "Failed to resize video.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileBase(header.Filename) + "_resized" + ext
	if err := sendFile(w, outPath.Name(), name, contentTypeForExt(ext)); err != nil {
		fmt.Printf("resize send error: %v\n", err)
	}
}

// HandleCompressVideo shrinks a video using a CRF derived from a 0-100 quality
// slider, optionally downscaling to a maximum width first.
func HandleCompressVideo(w http.ResponseWriter, r *http.Request) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	inPath, header, ok := prepareMediaUpload(w, r, "compress-in")
	if !ok {
		return
	}
	defer os.Remove(inPath)

	quality, hasQuality := clampInt(r.FormValue("quality"), 0, 100)
	if !hasQuality {
		quality = 60
	}

	ext := inputExt(header.Filename, ".mp4")
	isWebm := strings.EqualFold(strings.TrimPrefix(ext, "."), "webm")

	// Higher slider quality -> lower CRF (better quality, larger file).
	var crf int
	if isWebm {
		crf = int(math.Round(24 + float64(100-quality)/100*(40-24)))
	} else {
		crf = int(math.Round(18 + float64(100-quality)/100*(34-18)))
	}

	args := []string{"-i", inPath}
	if maxWidth, hasMax := clampInt(r.FormValue("maxWidth"), 16, 7680); hasMax {
		args = append(args, "-vf", fmt.Sprintf("scale='min(%d,iw)':-2", maxWidth))
	}
	if isWebm {
		args = append(args, "-c:v", "libvpx-vp9", "-crf", fmt.Sprintf("%d", crf), "-b:v", "0", "-c:a", "libopus")
	} else {
		args = append(args, "-c:v", "libx264", "-crf", fmt.Sprintf("%d", crf), "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart")
	}

	outPath, err := os.CreateTemp(tempRoot(), "compress-out-*"+ext)
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath.Close()
	defer os.Remove(outPath.Name())
	args = append(args, outPath.Name())

	if err := runFFmpeg(bin, args...); err != nil {
		fmt.Printf("compress error: %v\n", err)
		http.Error(w, "Failed to compress video.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileBase(header.Filename) + "_compressed" + ext
	if err := sendFile(w, outPath.Name(), name, contentTypeForExt(ext)); err != nil {
		fmt.Printf("compress send error: %v\n", err)
	}
}

var allowedConvertFormats = map[string]bool{
	"mp4": true, "webm": true, "mkv": true, "mov": true, "gif": true,
}

// HandleConvertVideo transcodes a video to a chosen container/format.
func HandleConvertVideo(w http.ResponseWriter, r *http.Request) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	inPath, header, ok := prepareMediaUpload(w, r, "convert-in")
	if !ok {
		return
	}
	defer os.Remove(inPath)

	target := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
	if !allowedConvertFormats[target] {
		http.Error(w, "Unsupported target format. Choose mp4, webm, mkv, mov, or gif.", http.StatusBadRequest)
		return
	}
	ext := "." + target

	outPath, err := os.CreateTemp(tempRoot(), "convert-out-*"+ext)
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath.Close()
	defer os.Remove(outPath.Name())

	args := []string{"-i", inPath}
	if target == "gif" {
		// A palette pass keeps GIF colors reasonable at a smaller, looping size.
		args = append(args, "-vf", "fps=12,scale=480:-1:flags=lanczos", "-loop", "0")
	} else {
		args = append(args, videoCodecArgs(ext)...)
	}
	args = append(args, outPath.Name())

	if err := runFFmpeg(bin, args...); err != nil {
		fmt.Printf("convert error: %v\n", err)
		http.Error(w, "Failed to convert video.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileBase(header.Filename) + ext
	if err := sendFile(w, outPath.Name(), name, contentTypeForExt(ext)); err != nil {
		fmt.Printf("convert send error: %v\n", err)
	}
}

// HandleSplitVideo cuts a video into multiple clips and returns them as a ZIP.
// Mode "parts" splits into N roughly equal clips; mode "interval" cuts every
// N seconds.
func HandleSplitVideo(w http.ResponseWriter, r *http.Request) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	inPath, header, ok := prepareMediaUpload(w, r, "split-in")
	if !ok {
		return
	}
	defer os.Remove(inPath)

	mode := strings.TrimSpace(r.FormValue("mode"))
	if mode == "" {
		mode = "parts"
	}

	var segmentTime float64
	switch mode {
	case "parts":
		parts, hasParts := clampInt(r.FormValue("parts"), 2, 100)
		if !hasParts {
			http.Error(w, "Enter how many parts to split into (2-100)", http.StatusBadRequest)
			return
		}
		duration := probeDuration(inPath)
		if duration <= 0 {
			http.Error(w, "Could not read the video duration.", http.StatusBadRequest)
			return
		}
		segmentTime = duration / float64(parts)
	case "interval":
		secs, hasSecs := parseSeconds(r.FormValue("interval"))
		if !hasSecs || secs <= 0 {
			http.Error(w, "Enter a clip length in seconds", http.StatusBadRequest)
			return
		}
		segmentTime = secs
	default:
		http.Error(w, "Invalid mode. Use parts or interval.", http.StatusBadRequest)
		return
	}

	outDir, err := os.MkdirTemp(tempRoot(), "split-clips-*")
	if err != nil {
		http.Error(w, "Failed to create workspace", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(outDir)

	// Stream-copy segmenting can only cut on existing keyframes, so a clip with
	// sparse keyframes would not honor the requested part count. Re-encode to
	// H.264/AAC with keyframes forced at each boundary; clips are emitted as MP4.
	segArg := trimNumber(segmentTime)
	pattern := filepath.Join(outDir, "clip_%03d.mp4")
	args := []string{
		"-i", inPath,
		"-force_key_frames", fmt.Sprintf("expr:gte(t,n_forced*%s)", segArg),
		"-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
		"-c:a", "aac",
		"-f", "segment",
		"-segment_time", segArg,
		"-reset_timestamps", "1",
		pattern,
	}
	if err := runFFmpeg(bin, args...); err != nil {
		fmt.Printf("split error: %v\n", err)
		http.Error(w, "Failed to split video.", http.StatusInternalServerError)
		return
	}

	clips, err := collectClips(outDir, ".mp4")
	if err != nil || len(clips) == 0 {
		http.Error(w, "No clips were produced.", http.StatusInternalServerError)
		return
	}

	zipFile, err := os.CreateTemp(tempRoot(), "split-clips-*.zip")
	if err != nil {
		http.Error(w, "Failed to create archive", http.StatusInternalServerError)
		return
	}
	zipPath := zipFile.Name()
	defer os.Remove(zipPath)

	if err := writeFilesToZip(zipFile, clips); err != nil {
		zipFile.Close()
		fmt.Printf("split zip error: %v\n", err)
		http.Error(w, "Failed to archive clips.", http.StatusInternalServerError)
		return
	}
	zipFile.Close()

	name := shared.SafeFileBase(header.Filename) + "_clips.zip"
	if err := sendFile(w, zipPath, name, "application/zip"); err != nil {
		fmt.Printf("split send error: %v\n", err)
	}
}

// HandleMergeVideo concatenates several uploaded clips into one video.
//
// Clips may differ in resolution, frame rate, codec, sample rate, or even lack
// audio entirely, so a single concat pass is unreliable. Instead this does a
// two-pass merge: pass 1 normalizes every clip to identical parameters (target
// resolution with letterbox padding, 30 fps, yuv420p, H.264 + stereo 44.1 kHz
// AAC, synthesizing silent audio for clips that have none); pass 2 then joins
// the now-uniform clips with the fast concat demuxer (stream copy). The output
// is always MP4.
func HandleMergeVideo(w http.ResponseWriter, r *http.Request) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse upload", http.StatusBadRequest)
		return
	}

	headers := uploadedFileHeaders(r)
	if len(headers) < 2 {
		http.Error(w, "Upload at least two video clips to merge", http.StatusBadRequest)
		return
	}

	workDir, err := os.MkdirTemp(tempRoot(), "merge-*")
	if err != nil {
		http.Error(w, "Failed to create workspace", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(workDir)

	// Save uploads in the order they were sent (which is the order the user
	// arranged them in the UI).
	inputs := make([]string, 0, len(headers))
	for i, header := range headers {
		f, err := header.Open()
		if err != nil {
			http.Error(w, "Failed to read an uploaded clip", http.StatusBadRequest)
			return
		}
		dst, err := os.CreateTemp(workDir, fmt.Sprintf("src-%03d-*%s", i, inputExt(header.Filename, ".mp4")))
		if err != nil {
			f.Close()
			http.Error(w, "Failed to store upload", http.StatusInternalServerError)
			return
		}
		if _, err := io.Copy(dst, f); err != nil {
			f.Close()
			dst.Close()
			http.Error(w, "Failed to store upload", http.StatusInternalServerError)
			return
		}
		f.Close()
		dst.Close()
		inputs = append(inputs, dst.Name())
	}

	// Target geometry comes from the first clip (falling back to 1280x720),
	// rounded to even dimensions which H.264/yuv420p requires.
	targetW, targetH := probeResolution(inputs[0])
	if targetW <= 0 || targetH <= 0 {
		targetW, targetH = 1280, 720
	}
	targetW -= targetW % 2
	targetH -= targetH % 2

	vf := fmt.Sprintf(
		"scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p",
		targetW, targetH, targetW, targetH,
	)

	// Pass 1: normalize each clip.
	normalized := make([]string, 0, len(inputs))
	for i, in := range inputs {
		out := filepath.Join(workDir, fmt.Sprintf("norm-%03d.mp4", i))
		var args []string
		if probeHasAudio(in) {
			args = []string{
				"-i", in,
				"-vf", vf,
				"-c:v", "libx264", "-preset", "veryfast",
				"-c:a", "aac", "-ar", "44100", "-ac", "2",
				out,
			}
		} else {
			// Synthesize silent stereo audio and trim it to the video length.
			args = []string{
				"-i", in,
				"-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
				"-filter_complex", "[0:v]" + vf + "[v]",
				"-map", "[v]", "-map", "1:a", "-shortest",
				"-c:v", "libx264", "-preset", "veryfast",
				"-c:a", "aac", "-ar", "44100", "-ac", "2",
				out,
			}
		}
		if err := runFFmpeg(bin, args...); err != nil {
			fmt.Printf("merge normalize error (clip %d): %v\n", i, err)
			http.Error(w, "Failed to prepare one of the clips for merging.", http.StatusInternalServerError)
			return
		}
		normalized = append(normalized, out)
	}

	// Pass 2: concat demuxer over the uniform clips (stream copy).
	listPath := filepath.Join(workDir, "concat.txt")
	var list strings.Builder
	for _, n := range normalized {
		// Paths are generated by os.CreateTemp/MkdirTemp, so they contain no
		// single quotes to escape.
		list.WriteString("file '")
		list.WriteString(n)
		list.WriteString("'\n")
	}
	if err := os.WriteFile(listPath, []byte(list.String()), 0o600); err != nil {
		http.Error(w, "Failed to write merge list", http.StatusInternalServerError)
		return
	}

	outPath := filepath.Join(workDir, "merged.mp4")
	if err := runFFmpeg(bin, "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", outPath); err != nil {
		fmt.Printf("merge concat error: %v\n", err)
		http.Error(w, "Failed to merge clips.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileBase(headers[0].Filename) + "_merged.mp4"
	if err := sendFile(w, outPath, name, contentTypeForExt(".mp4")); err != nil {
		fmt.Printf("merge send error: %v\n", err)
	}
}

// uploadedFileHeaders returns the multipart file headers in submission order,
// checking the field names the merge form might use.
func uploadedFileHeaders(r *http.Request) []*multipart.FileHeader {
	if r.MultipartForm == nil {
		return nil
	}
	for _, name := range []string{"file", "files", "video", "videos"} {
		if headers := r.MultipartForm.File[name]; len(headers) > 0 {
			return headers
		}
	}
	return nil
}

// collectClips lists generated segment files of the given extension in order.
func collectClips(dir, ext string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ext) {
			files = append(files, filepath.Join(dir, entry.Name()))
		}
	}
	sort.Strings(files)
	return files, nil
}

// videoOnlyCodec returns just the video encoder flags for a target container.
func videoOnlyCodec(ext string) []string {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "webm":
		return []string{"-c:v", "libvpx-vp9", "-b:v", "0"}
	case "ogv":
		return []string{"-c:v", "libtheora"}
	default:
		return []string{"-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"}
	}
}

// trimNumber formats a float seconds value compactly for ffmpeg args.
func trimNumber(v float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.3f", v), "0"), ".")
}
