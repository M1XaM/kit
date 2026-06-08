package features

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// AI Remove Background runs a neural-net saliency model locally to cut the
// subject out of an image. The inference itself can't live inside the
// pure-static `kit` binary, so it runs in a bundled sidecar (kit-bgremove) that
// this package shells out to — the same "detect an external helper, degrade
// gracefully when absent" pattern used for ffmpeg (see requireFFmpeg).
//
// Model weights are large and are NOT bundled. The user downloads the tier they
// want from the UI (and can delete it to reclaim space); weights live under the
// OS cache dir so they survive restarts and are easy to wipe.

// bgModel describes one selectable model tier and everything the UI needs to
// decide whether the machine can run it.
type bgModel struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Tier               string `json:"tier"` // light | medium | strong
	FileName           string `json:"-"`
	URL                string `json:"-"`
	MD5                string `json:"-"` // optional integrity check; skipped when empty
	SizeBytes          int64  `json:"sizeBytes"`
	MinRAMBytes        uint64 `json:"minRamBytes"`
	RecommendVRAMBytes uint64 `json:"recommendVramBytes"`
	GPURecommended     bool   `json:"gpuRecommended"`
	InputSize          int    `json:"inputSize"`
	Profile            string `json:"-"` // preprocessing profile passed to the sidecar
	Description        string `json:"description"`
}

const (
	mib = 1 << 20
	gib = 1 << 30
)

// bgModels is the registry surfaced to the UI. URLs/MD5s point at the
// well-known rembg ONNX release assets.
var bgModels = []bgModel{
	{
		ID:          "u2netp",
		Name:        "U²-Net (Lite)",
		Tier:        "light",
		FileName:    "u2netp.onnx",
		URL:         "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
		MD5:         "8e83ca70e441ab06c318d82300c84806",
		SizeBytes:   4_574_861,
		MinRAMBytes: 512 * mib,
		InputSize:   320,
		Profile:     "u2net",
		Description: "Fast, tiny model. Runs comfortably on any machine — great for quick cut-outs when you don't need the cleanest edges.",
	},
	{
		ID:                 "isnet",
		Name:               "ISNet (General)",
		Tier:               "medium",
		FileName:           "isnet-general-use.onnx",
		URL:                "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
		MD5:                "fc16ebd8b0c10d971d3513d564d01e29",
		SizeBytes:          176_069_933,
		MinRAMBytes:        2 * gib,
		RecommendVRAMBytes: 2 * gib,
		InputSize:          1024,
		Profile:            "isnet",
		Description: "Balanced quality and speed. A solid general-purpose choice with noticeably cleaner edges than the lite model.",
	},
	{
		ID:                 "birefnet",
		Name:               "BiRefNet (General)",
		Tier:               "strong",
		FileName:           "BiRefNet-general-epoch_244.onnx",
		URL:                "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx",
		MD5:                "7a35a0141cbbc80de11d9c9a28f52697",
		SizeBytes:          949_172_859,
		MinRAMBytes:        4 * gib,
		RecommendVRAMBytes: 4 * gib,
		GPURecommended:     true,
		InputSize:          1024,
		Profile:            "birefnet",
		Description: "Highest quality, hair-level detail. Heavy: needs plenty of RAM and is slow on CPU — a GPU is recommended.",
	},
}

func findBgModel(id string) (bgModel, bool) {
	for _, m := range bgModels {
		if m.ID == id {
			return m, true
		}
	}
	return bgModel{}, false
}

// modelsDir is where downloaded weights live: <user cache>/kit/models.
func modelsDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "kit", "models")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func modelPath(m bgModel) (string, error) {
	dir, err := modelsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, m.FileName), nil
}

// modelDownloaded reports whether the weights for m are present on disk.
func modelDownloaded(m bgModel) bool {
	p, err := modelPath(m)
	if err != nil {
		return false
	}
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Size() > 0
}

// bgEnginePath resolves the sidecar binary and the directory that holds its
// bundled shared libraries (ONNX Runtime, CUDA, cuDNN, …). Releases ship the
// sidecar and all its libs under a `lib/` folder next to the main executable:
//
//	<os>/install-kit
//	<os>/uninstall-kit
//	<os>/lib/kit-bgremove   + libonnxruntime.so, libcudnn*, …
//
// We look in lib/ first, then next to the executable (dev builds), then PATH.
// libDir is where the bundled CUDA/ONNX libraries live and is added to the
// sidecar's library search path at exec time. ok=false means the AI engine
// isn't available in this build — the feature degrades gracefully, like ffmpeg.
func bgEnginePath() (engine, libDir string, ok bool) {
	name := "kit-bgremove"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for _, cand := range []string{filepath.Join(dir, "lib", name), filepath.Join(dir, name)} {
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				return cand, filepath.Dir(cand), true
			}
		}
	}
	if p, err := exec.LookPath(name); err == nil {
		return p, filepath.Dir(p), true
	}
	return "", "", false
}

// ---- download tracking ------------------------------------------------------

type downloadState struct {
	Downloading bool    `json:"downloading"`
	Progress    float64 `json:"progress"` // 0..100
	Received    int64   `json:"received"`
	Total       int64   `json:"total"`
	Err         string  `json:"error,omitempty"`
}

var (
	dlMu      sync.Mutex
	downloads = map[string]*downloadState{}
)

func snapshotDownload(id string) downloadState {
	dlMu.Lock()
	defer dlMu.Unlock()
	if s, ok := downloads[id]; ok {
		return *s
	}
	return downloadState{}
}

// ---- HTTP handlers ----------------------------------------------------------

type bgModelView struct {
	bgModel
	Downloaded  bool    `json:"downloaded"`
	Downloading bool    `json:"downloading"`
	Progress    float64 `json:"progress"`
	Error       string  `json:"error,omitempty"`
}

type bgModelsResponse struct {
	EngineAvailable bool          `json:"engineAvailable"`
	Models          []bgModelView `json:"models"`
}

// HandleListBgModels returns the model registry plus per-model download state
// and whether the inference engine is present. The UI decides "can I run this"
// client-side by comparing each model's requirements against the live
// /api/system/metrics it already polls, so the gate stays real-time.
func HandleListBgModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	_, _, engineOK := bgEnginePath()
	views := make([]bgModelView, 0, len(bgModels))
	for _, m := range bgModels {
		st := snapshotDownload(m.ID)
		views = append(views, bgModelView{
			bgModel:     m,
			Downloaded:  modelDownloaded(m),
			Downloading: st.Downloading,
			Progress:    st.Progress,
			Error:       st.Err,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(bgModelsResponse{EngineAvailable: engineOK, Models: views})
}

type bgModelRequest struct {
	ID string `json:"id"`
}

func decodeModelID(r *http.Request) (string, bool) {
	var req bgModelRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		return "", false
	}
	return req.ID, req.ID != ""
}

// HandleDownloadBgModel starts (or no-ops) a background download of a model's
// weights and returns immediately; the client polls HandleListBgModels for
// progress. Idempotent when the file already exists or a download is in flight.
func HandleDownloadBgModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findBgModel(id)
	if !ok {
		http.Error(w, "Unknown model", http.StatusNotFound)
		return
	}
	if modelDownloaded(m) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ready"}`))
		return
	}

	dlMu.Lock()
	if st, exists := downloads[m.ID]; exists && st.Downloading {
		dlMu.Unlock()
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"downloading"}`))
		return
	}
	downloads[m.ID] = &downloadState{Downloading: true, Total: m.SizeBytes}
	dlMu.Unlock()

	go runModelDownload(m)

	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"started"}`))
}

// runModelDownload fetches the weights to a temp file (tracking progress),
// verifies the MD5 when known, then atomically moves it into place.
func runModelDownload(m bgModel) {
	setErr := func(msg string) {
		dlMu.Lock()
		downloads[m.ID] = &downloadState{Downloading: false, Err: msg, Total: m.SizeBytes}
		dlMu.Unlock()
	}

	dest, err := modelPath(m)
	if err != nil {
		setErr("Could not resolve models directory")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.URL, nil)
	if err != nil {
		setErr("Bad download URL")
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		setErr("Download failed: " + err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		setErr(fmt.Sprintf("Download failed: server returned %d", resp.StatusCode))
		return
	}

	total := m.SizeBytes
	if resp.ContentLength > 0 {
		total = resp.ContentLength
	}

	tmp, err := os.CreateTemp(filepath.Dir(dest), ".dl-*")
	if err != nil {
		setErr("Could not create temp file")
		return
	}
	tmpName := tmp.Name()

	hasher := md5.New()
	pw := &progressWriter{id: m.ID, total: total}
	_, copyErr := io.Copy(io.MultiWriter(tmp, hasher, pw), resp.Body)
	tmp.Close()
	if copyErr != nil {
		os.Remove(tmpName)
		setErr("Download interrupted: " + copyErr.Error())
		return
	}

	if m.MD5 != "" {
		if got := hex.EncodeToString(hasher.Sum(nil)); got != m.MD5 {
			os.Remove(tmpName)
			setErr("Downloaded file failed integrity check")
			return
		}
	}

	if err := os.Rename(tmpName, dest); err != nil {
		os.Remove(tmpName)
		setErr("Could not save model")
		return
	}

	dlMu.Lock()
	downloads[m.ID] = &downloadState{Downloading: false, Progress: 100, Received: total, Total: total}
	dlMu.Unlock()
}

// progressWriter updates the shared download state as bytes stream in.
type progressWriter struct {
	id       string
	received int64
	total    int64
}

func (p *progressWriter) Write(b []byte) (int, error) {
	n := len(b)
	p.received += int64(n)
	progress := 0.0
	if p.total > 0 {
		progress = float64(p.received) / float64(p.total) * 100
		if progress > 100 {
			progress = 100
		}
	}
	dlMu.Lock()
	downloads[p.id] = &downloadState{Downloading: true, Progress: progress, Received: p.received, Total: p.total}
	dlMu.Unlock()
	return n, nil
}

// HandleDeleteBgModel removes a downloaded model's weights to free storage.
func HandleDeleteBgModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findBgModel(id)
	if !ok {
		http.Error(w, "Unknown model", http.StatusNotFound)
		return
	}

	dlMu.Lock()
	if st, exists := downloads[m.ID]; exists && st.Downloading {
		dlMu.Unlock()
		http.Error(w, "Model is currently downloading", http.StatusConflict)
		return
	}
	delete(downloads, m.ID)
	dlMu.Unlock()

	p, err := modelPath(m)
	if err != nil {
		http.Error(w, "Could not resolve model path", http.StatusInternalServerError)
		return
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		http.Error(w, "Could not delete model", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"deleted"}`))
}

// bgRemoveTimeout caps a single inference so a stuck sidecar can't hang forever.
// BiRefNet on CPU can be slow, so this is generous.
const bgRemoveTimeout = 15 * time.Minute

// HandleRemoveBackground runs the chosen model over the uploaded image via the
// sidecar and streams back a transparent-background PNG.
func HandleRemoveBackground(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	engine, libDir, ok := bgEnginePath()
	if !ok {
		http.Error(w, "The AI background-removal engine is not available in this build. No image left your machine.", http.StatusServiceUnavailable)
		return
	}

	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse upload", http.StatusBadRequest)
		return
	}

	m, ok := findBgModel(r.FormValue("model"))
	if !ok {
		http.Error(w, "Choose a model first", http.StatusBadRequest)
		return
	}
	if !modelDownloaded(m) {
		http.Error(w, "That model hasn't been downloaded yet", http.StatusBadRequest)
		return
	}
	weights, err := modelPath(m)
	if err != nil {
		http.Error(w, "Could not resolve model path", http.StatusInternalServerError)
		return
	}

	file, header, err := getUploadedMedia(r)
	if err != nil {
		http.Error(w, "An image is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	inPath, err := saveUploadToTemp(file, header.Filename, "bgremove-in")
	if err != nil {
		http.Error(w, "Failed to store upload", http.StatusInternalServerError)
		return
	}
	defer os.Remove(inPath)

	outFile, err := os.CreateTemp("", "bgremove-out-*.png")
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath := outFile.Name()
	outFile.Close()
	defer os.Remove(outPath)

	ctx, cancel := context.WithTimeout(context.Background(), bgRemoveTimeout)
	defer cancel()

	// "auto" tries the GPU (CUDA) first and falls back to CPU inside the sidecar.
	cmd := exec.CommandContext(ctx, engine,
		"--model", weights,
		"--profile", m.Profile,
		"--input", inPath,
		"--output", outPath,
		"--provider", "auto",
	)
	// Point the sidecar at its bundled shared libraries (ONNX Runtime, CUDA,
	// cuDNN). These ship in libDir; the OS dynamic loader must find them there.
	cmd.Env = sidecarEnv(libDir)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	if runErr != nil {
		if ctx.Err() == context.DeadlineExceeded {
			http.Error(w, "Background removal timed out. Try a lighter model.", http.StatusGatewayTimeout)
			return
		}
		fmt.Printf("bgremove engine error: %v\nstdout: %s\nstderr: %s\n", runErr, stdout.String(), stderr.String())
		http.Error(w, "Background removal failed. See the Kit logs for details.", http.StatusInternalServerError)
		return
	}

	// The sidecar prints KIT_PROVIDER=<cuda|cpu>; surface it so the UI can show
	// whether the run used the GPU.
	if p := parseProvider(stdout.String()); p != "" {
		w.Header().Set("X-Kit-Provider", p)
	}

	name := shared.SafeFileBase(header.Filename) + "_nobg.png"
	if err := sendFile(w, outPath, name, "image/png"); err != nil {
		fmt.Printf("bgremove send error: %v\n", err)
	}
}

// sidecarEnv augments the current environment so the sidecar's dynamic loader
// finds the bundled libraries in libDir (LD_LIBRARY_PATH on Linux; PATH on
// Windows, where DLLs are also located next to the .exe anyway).
func sidecarEnv(libDir string) []string {
	env := os.Environ()
	key := "LD_LIBRARY_PATH"
	if runtime.GOOS == "windows" {
		key = "PATH"
	}
	prev := ""
	for _, kv := range env {
		if strings.HasPrefix(kv, key+"=") {
			prev = strings.TrimPrefix(kv, key+"=")
			break
		}
	}
	val := libDir
	if prev != "" {
		val = libDir + string(os.PathListSeparator) + prev
	}
	return append(env, key+"="+val)
}

// parseProvider extracts the provider name from the sidecar's KIT_PROVIDER line.
func parseProvider(stdout string) string {
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "KIT_PROVIDER=") {
			return strings.TrimPrefix(line, "KIT_PROVIDER=")
		}
	}
	return ""
}
