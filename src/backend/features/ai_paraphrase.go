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

// AI Paraphrase rewrites text with a local sequence-to-sequence model. It shares
// the generic kit-text2text engine with AI Summarize (same T5 mechanism, just a
// different prefix and weights) and reuses the multi-file download machinery in
// ai_summarize.go (sumFile, hfFiles, downloadFile, sumProgress). The distinctive
// UI trick — paraphrasing only the words the user highlights in the output — is
// handled client-side: the page sends just the selected spans, and this handler
// runs them through the sidecar in one batch.
//
// The models are instruction-tuned FLAN-T5 (plain T5 can't paraphrase): they
// follow the "paraphrase: " prefix to rewrite the input.

type paraModel struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Tier               string `json:"tier"` // light | medium | strong
	Files              []sumFile
	SizeBytes          int64  `json:"sizeBytes"`
	MinRAMBytes        uint64 `json:"minRamBytes"`
	RecommendVRAMBytes uint64 `json:"recommendVramBytes"`
	GPURecommended     bool   `json:"gpuRecommended"`
	Prefix             string `json:"-"`
	DecoderStart       int    `json:"-"`
	EOS                int    `json:"-"`
	MaxNewTokens       int    `json:"-"`
	Description        string `json:"description"`
}

var paraModels = func() []paraModel {
	mk := func(id, name, tier, repo, desc string, enc, dec, tok int64, minRAM, vram uint64, gpu bool) paraModel {
		return paraModel{
			ID: id, Name: name, Tier: tier,
			Files:       hfFiles(repo, enc, dec, tok),
			SizeBytes:   enc + dec + tok,
			MinRAMBytes: minRAM, RecommendVRAMBytes: vram, GPURecommended: gpu,
			Prefix: "paraphrase: ", DecoderStart: 0, EOS: 1, MaxNewTokens: 96,
			Description: desc,
		}
	}
	return []paraModel{
		mk("flan-t5-small", "FLAN-T5 Small", "light", "Xenova/flan-t5-small",
			"Fast and light. Runs anywhere — good for quick rewrites of words and short phrases, though changes are conservative.",
			141_456_352, 232_553_640, 2_422_164, 1*gib, 0, false),
		mk("flan-t5-base", "FLAN-T5 Base", "strong", "Xenova/flan-t5-base",
			"Instruction-tuned for noticeably better, more varied rewrites. Heavier and slow on CPU — a GPU is recommended.",
			438_697_388, 650_848_961, 2_422_164, 3*gib, 3*gib, true),
	}
}()

func findParaModel(id string) (paraModel, bool) {
	for _, m := range paraModels {
		if m.ID == id {
			return m, true
		}
	}
	return paraModel{}, false
}

// paraModelDir is where a paraphrase model's files live:
// <user cache>/kit/models/paraphrase/<id>.
func paraModelDir(m paraModel) (string, error) {
	base, err := modelsDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "paraphrase", m.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func paraModelDownloaded(m paraModel) bool {
	base, err := modelsDir()
	if err != nil {
		return false
	}
	dir := filepath.Join(base, "paraphrase", m.ID)
	for _, f := range m.Files {
		st, err := os.Stat(filepath.Join(dir, f.Name))
		if err != nil || st.IsDir() || st.Size() == 0 {
			return false
		}
	}
	return true
}

func paraEnginePath() (engine, libDir string, ok bool) {
	return findSidecar("kit-text2text")
}

// ---- HTTP handlers ----------------------------------------------------------

type paraModelView struct {
	paraModel
	Downloaded  bool    `json:"downloaded"`
	Downloading bool    `json:"downloading"`
	Progress    float64 `json:"progress"`
	Error       string  `json:"error,omitempty"`
}

type paraModelsResponse struct {
	EngineAvailable bool            `json:"engineAvailable"`
	Models          []paraModelView `json:"models"`
}

func HandleListParaModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, _, engineOK := paraEnginePath()
	views := make([]paraModelView, 0, len(paraModels))
	for _, m := range paraModels {
		st := snapshotDownload(m.ID)
		views = append(views, paraModelView{
			paraModel:   m,
			Downloaded:  paraModelDownloaded(m),
			Downloading: st.Downloading,
			Progress:    st.Progress,
			Error:       st.Err,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(paraModelsResponse{EngineAvailable: engineOK, Models: views})
}

func HandleDownloadParaModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findParaModel(id)
	if !ok {
		http.Error(w, "Unknown model", http.StatusNotFound)
		return
	}
	if paraModelDownloaded(m) {
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

	go runParaDownload(m)

	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"started"}`))
}

// runParaDownload fetches each of the model's files (reusing the generic
// downloadFile/sumProgress helpers) into its directory, tracking progress.
func runParaDownload(m paraModel) {
	setErr := func(msg string) {
		dlMu.Lock()
		downloads[m.ID] = &downloadState{Downloading: false, Err: msg, Total: m.SizeBytes}
		dlMu.Unlock()
	}

	dir, err := paraModelDir(m)
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
			pw.add(f.Size)
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

func HandleDeleteParaModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findParaModel(id)
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
	if err := os.RemoveAll(filepath.Join(base, "paraphrase", m.ID)); err != nil {
		http.Error(w, "Could not delete model", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"deleted"}`))
}

const paraphraseTimeout = 10 * time.Minute

// maxParaSegments caps how many highlighted spans one request may paraphrase, so
// a user can't queue an unbounded amount of generation work in a single click.
const maxParaSegments = 64

type paraphraseRequest struct {
	Model    string   `json:"model"`
	Segments []string `json:"segments"`
}

type paraphraseResponse struct {
	Paraphrases []string `json:"paraphrases"`
	Provider    string   `json:"provider"`
}

// HandleParaphrase rewrites each highlighted span via the sidecar in one batch
// (a single model load) and returns the rewrites in the same order, so the page
// can splice them back into the output in place.
func HandleParaphrase(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	engine, libDir, ok := paraEnginePath()
	if !ok {
		http.Error(w, "The AI paraphrasing engine is not available in this build. No text left your machine.", http.StatusServiceUnavailable)
		return
	}

	var req paraphraseRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 2<<20)).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if len(req.Segments) == 0 {
		http.Error(w, "Highlight some words to paraphrase", http.StatusBadRequest)
		return
	}
	if len(req.Segments) > maxParaSegments {
		http.Error(w, "Too many highlighted spans at once", http.StatusBadRequest)
		return
	}

	m, ok := findParaModel(req.Model)
	if !ok {
		http.Error(w, "Choose a model first", http.StatusBadRequest)
		return
	}
	if !paraModelDownloaded(m) {
		http.Error(w, "That model hasn't been downloaded yet", http.StatusBadRequest)
		return
	}
	dir, err := paraModelDir(m)
	if err != nil {
		http.Error(w, "Could not resolve model path", http.StatusInternalServerError)
		return
	}

	inBytes, err := json.Marshal(req.Segments)
	if err != nil {
		http.Error(w, "Invalid segments", http.StatusBadRequest)
		return
	}
	inFile, err := os.CreateTemp(tempRoot(), "paraphrase-in-*.json")
	if err != nil {
		http.Error(w, "Failed to stage input", http.StatusInternalServerError)
		return
	}
	inPath := inFile.Name()
	defer os.Remove(inPath)
	if _, err := inFile.Write(inBytes); err != nil {
		inFile.Close()
		http.Error(w, "Failed to stage input", http.StatusInternalServerError)
		return
	}
	inFile.Close()

	outFile, err := os.CreateTemp(tempRoot(), "paraphrase-out-*.json")
	if err != nil {
		http.Error(w, "Failed to create output", http.StatusInternalServerError)
		return
	}
	outPath := outFile.Name()
	outFile.Close()
	defer os.Remove(outPath)

	ctx, cancel := context.WithTimeout(context.Background(), paraphraseTimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, engine,
		"--encoder", filepath.Join(dir, "encoder_model.onnx"),
		"--decoder", filepath.Join(dir, "decoder_model.onnx"),
		"--tokenizer", filepath.Join(dir, "tokenizer.json"),
		"--input", inPath,
		"--output", outPath,
		"--batch",
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
	if runErr := runHeavyJob(ctx, cmd.Run); runErr != nil {
		if ctx.Err() == context.DeadlineExceeded {
			http.Error(w, "Paraphrasing timed out. Try a lighter model or fewer words.", http.StatusGatewayTimeout)
			return
		}
		fmt.Printf("paraphrase engine error: %v\nstdout: %s\nstderr: %s\n", runErr, stdout.String(), stderr.String())
		http.Error(w, "Paraphrasing failed. See the Kit logs for details.", http.StatusInternalServerError)
		return
	}

	outBytes, err := os.ReadFile(outPath)
	if err != nil {
		http.Error(w, "Could not read paraphrases", http.StatusInternalServerError)
		return
	}
	var paraphrases []string
	if err := json.Unmarshal(outBytes, &paraphrases); err != nil {
		http.Error(w, "Bad engine output", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(paraphraseResponse{Paraphrases: paraphrases, Provider: parseProvider(stdout.String())})
}
