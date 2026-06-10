package features

import (
	"fmt"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"strings"
)

var allowedAudioFormats = map[string]bool{
	"mp3": true, "wav": true, "flac": true, "ogg": true, "opus": true, "m4a": true, "aac": true,
}

// HandleConvertAudio transcodes an audio file (or the audio track of a video)
// to a chosen format via ffmpeg.
//
// Form fields:
//
//	format  - target format: mp3, wav, flac, ogg, opus, m4a or aac
//	bitrate - optional target bitrate in kbps (lossy formats only)
func HandleConvertAudio(w http.ResponseWriter, r *http.Request) {
	bin, ok := requireFFmpeg(w)
	if !ok {
		return
	}
	inPath, header, ok := prepareMediaUpload(w, r, "aconvert-in")
	if !ok {
		return
	}
	defer os.Remove(inPath)

	target := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
	if !allowedAudioFormats[target] {
		http.Error(w, "Unsupported target format. Choose mp3, wav, flac, ogg, opus, m4a or aac.", http.StatusBadRequest)
		return
	}
	ext := "." + target

	codec, lossy := audioCodecArgs(ext)
	args := []string{"-i", inPath, "-vn"}
	args = append(args, codec...)
	if bitrate, hasBitrate := clampInt(r.FormValue("bitrate"), 8, 320); hasBitrate && lossy {
		args = append(args, "-b:a", fmt.Sprintf("%dk", bitrate))
	}

	outPath, err := os.CreateTemp("", "aconvert-out-*"+ext)
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath.Close()
	defer os.Remove(outPath.Name())
	args = append(args, outPath.Name())

	if err := runFFmpeg(bin, args...); err != nil {
		fmt.Printf("convert audio error: %v\n", err)
		http.Error(w, "Failed to convert audio.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileBase(header.Filename) + ext
	if err := sendFile(w, outPath.Name(), name, contentTypeForExt(ext)); err != nil {
		fmt.Printf("convert audio send error: %v\n", err)
	}
}
