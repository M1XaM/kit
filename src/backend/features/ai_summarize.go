package features

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// AI Summarize runs a local sequence-to-sequence model (the T5 family) to
// condense text. Like AI Remove Background it runs in a bundled sidecar — the
// generic kit-text2text engine, shared with AI Paraphrase — that this package
// shells out to, degrading gracefully when the engine isn't in the build. Model
// weights are large and downloaded on demand into the OS cache dir; the registry
// below is what the UI renders.
//
// This file reuses the generic helpers in ai_bgremove.go (modelsDir, the
// download-state map, sidecarEnv, parseProvider, findSidecar) so the two AI
// features behave identically from the user's point of view.

// sumFile is one downloadable artifact of a model (an ONNX graph or tokenizer).
type sumFile struct {
	Name string // local filename, also how the sidecar expects to find it
	URL  string
	Size int64
}

// sumModel is one selectable summarization model tier.
type sumModel struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Tier               string `json:"tier"` // light | medium | strong
	Files              []sumFile
	SizeBytes          int64  `json:"sizeBytes"`
	MinRAMBytes        uint64 `json:"minRamBytes"`
	RecommendVRAMBytes uint64 `json:"recommendVramBytes"`
	GPURecommended     bool   `json:"gpuRecommended"`
	Prefix             string `json:"-"` // task prefix the model expects (T5: "summarize: ")
	DecoderStart       int    `json:"-"`
	EOS                int    `json:"-"`
	MaxNewTokens       int    `json:"-"`
	Description        string `json:"description"`
}

// hfFiles builds the standard 3-file set (encoder, decoder, tokenizer) for a
// Xenova ONNX repo. encSize/decSize/tokSize come from the release assets.
func hfFiles(repo string, encSize, decSize, tokSize int64) []sumFile {
	base := "https://huggingface.co/" + repo + "/resolve/main/"
	return []sumFile{
		{Name: "encoder_model.onnx", URL: base + "onnx/encoder_model.onnx", Size: encSize},
		{Name: "decoder_model.onnx", URL: base + "onnx/decoder_model.onnx", Size: decSize},
		{Name: "tokenizer.json", URL: base + "tokenizer.json", Size: tokSize},
	}
}

// sumModels is the registry surfaced to the UI. All are T5-family models, so
// they share the "summarize: " prefix and T5's pad/eos ids (0/1).
var sumModels = func() []sumModel {
	mk := func(id, name, tier, repo, desc string, enc, dec, tok int64, minRAM, vram uint64, gpu bool) sumModel {
		return sumModel{
			ID: id, Name: name, Tier: tier,
			Files:       hfFiles(repo, enc, dec, tok),
			SizeBytes:   enc + dec + tok,
			MinRAMBytes: minRAM, RecommendVRAMBytes: vram, GPURecommended: gpu,
			Prefix: "summarize: ", DecoderStart: 0, EOS: 1, MaxNewTokens: 160,
			Description: desc,
		}
	}
	return []sumModel{
		mk("t5-small", "T5 Small", "light", "Xenova/t5-small",
			"Fast and light. Runs comfortably on any machine — great for quick summaries when you don't need the highest quality.",
			141_404_302, 166_670_419, 2_422_095, 1*gib, 0, false),
		mk("t5-base", "T5 Base", "medium", "Xenova/t5-base",
			"Balanced quality and speed. Noticeably better summaries than the light model; still runs on the CPU.",
			438_666_548, 552_116_757, 2_422_095, 2*gib, 2*gib, false),
		mk("flan-t5-base", "FLAN-T5 Base", "strong", "Xenova/flan-t5-base",
			"Instruction-tuned for the best quality. Heavier and slow on CPU — a GPU is recommended.",
			438_697_388, 650_848_961, 2_422_164, 3*gib, 3*gib, true),
	}
}()

func findSumModel(id string) (sumModel, bool) {
	for _, m := range sumModels {
		if m.ID == id {
			return m, true
		}
	}
	return sumModel{}, false
}

// summModelDir is where a summarizer model's files live:
// <user cache>/kit/models/summarize/<id>. Kept under the same models root as the
// background-removal weights so a single uninstall wipes everything.
func summModelDir(m sumModel) (string, error) {
	base, err := modelsDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "summarize", m.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// summModelDownloaded reports whether every file of m is present on disk.
func summModelDownloaded(m sumModel) bool {
	base, err := modelsDir()
	if err != nil {
		return false
	}
	dir := filepath.Join(base, "summarize", m.ID)
	for _, f := range m.Files {
		st, err := os.Stat(filepath.Join(dir, f.Name))
		if err != nil || st.IsDir() || st.Size() == 0 {
			return false
		}
	}
	return true
}

func sumEnginePath() (engine, libDir string, ok bool) {
	return findSidecar("kit-text2text")
}

// ---- HTTP handlers ----------------------------------------------------------

type sumModelView struct {
	sumModel
	Downloaded  bool    `json:"downloaded"`
	Downloading bool    `json:"downloading"`
	Progress    float64 `json:"progress"`
	Error       string  `json:"error,omitempty"`
}

type sumModelsResponse struct {
	EngineAvailable bool           `json:"engineAvailable"`
	Models          []sumModelView `json:"models"`
}

// HandleListSummModels returns the registry plus per-model download state and
// whether the inference engine is present. Mirrors HandleListBgModels.
func HandleListSummModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, _, engineOK := sumEnginePath()
	views := make([]sumModelView, 0, len(sumModels))
	for _, m := range sumModels {
		st := snapshotDownload(m.ID)
		views = append(views, sumModelView{
			sumModel:    m,
			Downloaded:  summModelDownloaded(m),
			Downloading: st.Downloading,
			Progress:    st.Progress,
			Error:       st.Err,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sumModelsResponse{EngineAvailable: engineOK, Models: views})
}

// HandleDownloadSummModel starts a background multi-file download and returns
// immediately; the client polls HandleListSummModels for progress.
func HandleDownloadSummModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findSumModel(id)
	if !ok {
		http.Error(w, "Unknown model", http.StatusNotFound)
		return
	}
	if summModelDownloaded(m) {
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

	go runSummDownload(m)

	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"started"}`))
}

// runSummDownload fetches each of the model's files into its directory, tracking
// cumulative progress, and skips files that are already complete.
func runSummDownload(m sumModel) {
	setErr := func(msg string) {
		dlMu.Lock()
		downloads[m.ID] = &downloadState{Downloading: false, Err: msg, Total: m.SizeBytes}
		dlMu.Unlock()
	}

	dir, err := summModelDir(m)
	if err != nil {
		setErr("Could not resolve models directory")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Hour)
	defer cancel()

	pw := &sumProgress{id: m.ID, total: m.SizeBytes}
	for _, f := range m.Files {
		dest := filepath.Join(dir, f.Name)
		if st, err := os.Stat(dest); err == nil && st.Size() == f.Size {
			pw.add(f.Size) // already downloaded; count it toward progress
			continue
		}
		if err := downloadFile(ctx, f, dest, pw); err != nil {
			setErr(err.Error())
			return
		}
	}

	dlMu.Lock()
	downloads[m.ID] = &downloadState{Downloading: false, Progress: 100, Received: m.SizeBytes, Total: m.SizeBytes}
	dlMu.Unlock()
}

// downloadFile streams one file to a temp path (updating progress) then renames
// it into place, so a partial download never looks complete.
func downloadFile(ctx context.Context, f sumFile, dest string, pw *sumProgress) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, f.URL, nil)
	if err != nil {
		return fmt.Errorf("bad download URL for %s", f.Name)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("download failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: server returned %d for %s", resp.StatusCode, f.Name)
	}

	tmp, err := os.CreateTemp(filepath.Dir(dest), ".dl-*")
	if err != nil {
		return fmt.Errorf("could not create temp file")
	}
	tmpName := tmp.Name()
	_, copyErr := io.Copy(io.MultiWriter(tmp, pw), resp.Body)
	tmp.Close()
	if copyErr != nil {
		os.Remove(tmpName)
		return fmt.Errorf("download interrupted: %v", copyErr)
	}
	if err := os.Rename(tmpName, dest); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("could not save %s", f.Name)
	}
	return nil
}

// sumProgress accumulates received bytes across a model's files and publishes
// the percentage into the shared download-state map.
type sumProgress struct {
	id       string
	total    int64
	received int64
}

func (p *sumProgress) add(n int64) {
	p.received += n
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
}

func (p *sumProgress) Write(b []byte) (int, error) {
	p.add(int64(len(b)))
	return len(b), nil
}

// HandleDeleteSummModel removes a downloaded model's files to free storage.
func HandleDeleteSummModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findSumModel(id)
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

	base, err := modelsDir()
	if err != nil {
		http.Error(w, "Could not resolve model path", http.StatusInternalServerError)
		return
	}
	if err := os.RemoveAll(filepath.Join(base, "summarize", m.ID)); err != nil {
		http.Error(w, "Could not delete model", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"deleted"}`))
}

// summarizeTimeout caps a single run. CPU generation on the larger models is
// slow, so this is generous.
const summarizeTimeout = 10 * time.Minute

type summarizeRequest struct {
	Model string `json:"model"`
	Text  string `json:"text"`
}

type summarizeResponse struct {
	Summary  string `json:"summary"`
	Provider string `json:"provider"`
}

// HandleSummarize runs the chosen model over the posted text via the sidecar and
// returns the summary plus which provider (GPU/CPU) actually ran.
func HandleSummarize(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	engine, libDir, ok := sumEnginePath()
	if !ok {
		http.Error(w, "The AI summarization engine is not available in this build. No text left your machine.", http.StatusServiceUnavailable)
		return
	}

	var req summarizeRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	if req.Text == "" {
		http.Error(w, "Enter some text to summarize", http.StatusBadRequest)
		return
	}

	m, ok := findSumModel(req.Model)
	if !ok {
		http.Error(w, "Choose a model first", http.StatusBadRequest)
		return
	}
	if !summModelDownloaded(m) {
		http.Error(w, "That model hasn't been downloaded yet", http.StatusBadRequest)
		return
	}
	dir, err := summModelDir(m)
	if err != nil {
		http.Error(w, "Could not resolve model path", http.StatusInternalServerError)
		return
	}

	inFile, err := os.CreateTemp("", "summarize-in-*.txt")
	if err != nil {
		http.Error(w, "Failed to stage input", http.StatusInternalServerError)
		return
	}
	inPath := inFile.Name()
	defer os.Remove(inPath)
	if _, err := inFile.WriteString(req.Text); err != nil {
		inFile.Close()
		http.Error(w, "Failed to stage input", http.StatusInternalServerError)
		return
	}
	inFile.Close()

	outFile, err := os.CreateTemp("", "summarize-out-*.txt")
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath := outFile.Name()
	outFile.Close()
	defer os.Remove(outPath)

	ctx, cancel := context.WithTimeout(context.Background(), summarizeTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, engine,
		"--encoder", filepath.Join(dir, "encoder_model.onnx"),
		"--decoder", filepath.Join(dir, "decoder_model.onnx"),
		"--tokenizer", filepath.Join(dir, "tokenizer.json"),
		"--input", inPath,
		"--output", outPath,
		"--prefix", m.Prefix,
		"--max-new", fmt.Sprintf("%d", m.MaxNewTokens),
		"--decoder-start", fmt.Sprintf("%d", m.DecoderStart),
		"--eos", fmt.Sprintf("%d", m.EOS),
		"--provider", "auto",
	)
	cmd.Env = sidecarEnv(libDir)

	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if runErr := cmd.Run(); runErr != nil {
		if ctx.Err() == context.DeadlineExceeded {
			http.Error(w, "Summarization timed out. Try a lighter model or shorter text.", http.StatusGatewayTimeout)
			return
		}
		fmt.Printf("summarize engine error: %v\nstdout: %s\nstderr: %s\n", runErr, stdout.String(), stderr.String())
		http.Error(w, "Summarization failed. See the Kit logs for details.", http.StatusInternalServerError)
		return
	}

	summary, err := os.ReadFile(outPath)
	if err != nil {
		http.Error(w, "Could not read summary", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summarizeResponse{
		Summary:  strings.TrimSpace(string(summary)),
		Provider: parseProvider(stdout.String()),
	})
}
