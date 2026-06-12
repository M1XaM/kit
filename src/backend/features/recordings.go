package features

import (
	"encoding/json"
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Recording pages (Record Audio, Record Video, Screen Recording) offer "Save"
// next to "Save as". Save stores the clip on the machine under
// data/<feature-name>/ next to the installed binary; Save as stays fully
// client-side via the browser's file picker.

// recordingFeatures is the allowlist of folders the save endpoint may write to.
var recordingFeatures = map[string]bool{
	"record-audio":     true,
	"record-video":     true,
	"screen-recording": true,
}

// HandleSaveRecording stores an uploaded clip under data/<feature>/.
//
// Form fields:
//
//	feature - one of record-audio, record-video, screen-recording
//	file    - the recorded media blob
//
// Responds with JSON {"path": "<absolute path of the saved file>"}.
func HandleSaveRecording(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse upload", http.StatusBadRequest)
		return
	}

	feature := strings.TrimSpace(r.FormValue("feature"))
	if !recordingFeatures[feature] {
		http.Error(w, "Unknown feature.", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "A recording file is required.", http.StatusBadRequest)
		return
	}
	defer file.Close()

	dir, err := dataDir(feature)
	if err != nil {
		http.Error(w, "Failed to open the save folder.", http.StatusInternalServerError)
		return
	}

	name := shared.SafeFileName(header.Filename)
	if name == "" || name == "file" {
		name = "recording"
	}
	// Never overwrite an earlier take: pick a free name with a " (n)" suffix.
	path := filepath.Join(dir, name)
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for n := 2; ; n++ {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			break
		}
		path = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, n, ext))
	}

	// Write to a temp file in the same directory, then rename, so an
	// interrupted upload never leaves a half-written recording behind.
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		http.Error(w, "Failed to save the recording.", http.StatusInternalServerError)
		return
	}
	if _, err := io.Copy(tmp, file); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		http.Error(w, "Failed to save the recording.", http.StatusInternalServerError)
		return
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		http.Error(w, "Failed to save the recording.", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		http.Error(w, "Failed to save the recording.", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"path": path})
}
