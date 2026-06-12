package features

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// OCR recognition itself runs fully client-side (tesseract.js). The backend
// only manages language models: English ships inside the app bundle, every
// other language is downloaded on demand from the official tessdata_fast
// repository into data/ocr-models/ and served back to the in-browser engine.

// ocrModel describes one Tesseract language pack.
type ocrModel struct {
	ID        string `json:"id"`   // tesseract language code, e.g. "spa"
	Name      string `json:"name"` // display name
	SizeBytes int64  `json:"sizeBytes"`
	Bundled   bool   `json:"bundled"` // shipped with Kit, always available
}

// ocrModels is the curated registry surfaced to the UI. Sizes are the actual
// tessdata_fast file sizes (display only; the download cap is independent).
var ocrModels = []ocrModel{
	{ID: "eng", Name: "English", SizeBytes: 4_113_088, Bundled: true},
	{ID: "spa", Name: "Spanish", SizeBytes: 2_905_983},
	{ID: "fra", Name: "French", SizeBytes: 3_972_885},
	{ID: "deu", Name: "German", SizeBytes: 3_201_318},
	{ID: "ita", Name: "Italian", SizeBytes: 3_104_584},
	{ID: "por", Name: "Portuguese", SizeBytes: 3_092_657},
	{ID: "nld", Name: "Dutch", SizeBytes: 3_794_252},
	{ID: "pol", Name: "Polish", SizeBytes: 4_279_837},
	{ID: "ron", Name: "Romanian", SizeBytes: 2_891_098},
	{ID: "rus", Name: "Russian", SizeBytes: 5_209_830},
	{ID: "ukr", Name: "Ukrainian", SizeBytes: 4_682_354},
	{ID: "tur", Name: "Turkish", SizeBytes: 3_413_416},
	{ID: "ces", Name: "Czech", SizeBytes: 3_643_953},
	{ID: "hun", Name: "Hungarian", SizeBytes: 3_905_771},
	{ID: "ell", Name: "Greek", SizeBytes: 2_339_375},
	{ID: "ara", Name: "Arabic", SizeBytes: 2_494_806},
	{ID: "hin", Name: "Hindi", SizeBytes: 5_077_585},
	{ID: "chi_sim", Name: "Chinese (Simplified)", SizeBytes: 2_411_434},
	{ID: "jpn", Name: "Japanese", SizeBytes: 2_363_727},
	{ID: "kor", Name: "Korean", SizeBytes: 1_650_682},
}

// ocrDownloadCap is the hard byte limit for one language download; the largest
// tessdata_fast pack is well under this.
const ocrDownloadCap = 64 << 20

const ocrDownloadURL = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/%s.traineddata"

var (
	ocrMu        sync.Mutex
	ocrDownloads = map[string]*downloadState{}
)

func findOcrModel(id string) (ocrModel, bool) {
	for _, m := range ocrModels {
		if m.ID == id {
			return m, true
		}
	}
	return ocrModel{}, false
}

// ocrModelPath is where a downloaded language pack lives, stored gzipped so it
// can be served byte-for-byte to tesseract.js (which expects .traineddata.gz).
func ocrModelPath(id string) (string, error) {
	dir, err := dataDir("ocr-models")
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, id+".traineddata.gz"), nil
}

func ocrModelDownloaded(m ocrModel) bool {
	if m.Bundled {
		return true
	}
	p, err := ocrModelPath(m.ID)
	if err != nil {
		return false
	}
	st, err := os.Stat(p)
	return err == nil && !st.IsDir() && st.Size() > 0
}

func snapshotOcrDownload(id string) downloadState {
	ocrMu.Lock()
	defer ocrMu.Unlock()
	if s, ok := ocrDownloads[id]; ok {
		return *s
	}
	return downloadState{}
}

type ocrModelView struct {
	ocrModel
	Downloaded  bool    `json:"downloaded"`
	Downloading bool    `json:"downloading"`
	Progress    float64 `json:"progress"`
	Error       string  `json:"error,omitempty"`
}

// HandleListOcrModels returns the language registry plus download state.
func HandleListOcrModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	views := make([]ocrModelView, 0, len(ocrModels))
	for _, m := range ocrModels {
		st := snapshotOcrDownload(m.ID)
		views = append(views, ocrModelView{
			ocrModel:    m,
			Downloaded:  ocrModelDownloaded(m),
			Downloading: st.Downloading,
			Progress:    st.Progress,
			Error:       st.Err,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"models": views})
}

// HandleDownloadOcrModel starts a background download of one language pack and
// returns immediately; the client polls HandleListOcrModels for progress.
func HandleDownloadOcrModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findOcrModel(id)
	if !ok {
		http.Error(w, "Unknown language", http.StatusNotFound)
		return
	}
	if ocrModelDownloaded(m) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ready"}`))
		return
	}

	ocrMu.Lock()
	if st, exists := ocrDownloads[m.ID]; exists && st.Downloading {
		ocrMu.Unlock()
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"downloading"}`))
		return
	}
	ocrDownloads[m.ID] = &downloadState{Downloading: true, Total: m.SizeBytes}
	ocrMu.Unlock()

	go runOcrDownload(m)

	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"started"}`))
}

func runOcrDownload(m ocrModel) {
	setErr := func(msg string) {
		ocrMu.Lock()
		ocrDownloads[m.ID] = &downloadState{Downloading: false, Err: msg, Total: m.SizeBytes}
		ocrMu.Unlock()
	}
	setProgress := func(received, total int64) {
		progress := 0.0
		if total > 0 {
			progress = float64(received) / float64(total) * 100
			if progress > 100 {
				progress = 100
			}
		}
		ocrMu.Lock()
		ocrDownloads[m.ID] = &downloadState{Downloading: true, Progress: progress, Received: received, Total: total}
		ocrMu.Unlock()
	}

	dest, err := ocrModelPath(m.ID)
	if err != nil {
		setErr("Could not resolve the OCR models directory")
		return
	}

	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Get(fmt.Sprintf(ocrDownloadURL, m.ID))
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
		setErr("Could not create a temp file")
		return
	}
	tmpName := tmp.Name()

	// Store gzipped: tesseract.js fetches <lang>.traineddata.gz and gunzips it.
	gz := gzip.NewWriter(tmp)
	var received int64
	buf := make([]byte, 256<<10)
	limited := io.LimitReader(resp.Body, ocrDownloadCap+1)
	for {
		n, readErr := limited.Read(buf)
		if n > 0 {
			received += int64(n)
			if received > ocrDownloadCap {
				gz.Close()
				tmp.Close()
				os.Remove(tmpName)
				setErr("Download was much larger than expected; aborted")
				return
			}
			if _, err := gz.Write(buf[:n]); err != nil {
				gz.Close()
				tmp.Close()
				os.Remove(tmpName)
				setErr("Could not write the language pack")
				return
			}
			setProgress(received, total)
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			gz.Close()
			tmp.Close()
			os.Remove(tmpName)
			setErr("Download interrupted: " + readErr.Error())
			return
		}
	}
	if err := gz.Close(); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		setErr("Could not finalize the language pack")
		return
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		setErr("Could not finalize the language pack")
		return
	}
	if err := os.Rename(tmpName, dest); err != nil {
		os.Remove(tmpName)
		setErr("Could not save the language pack")
		return
	}

	ocrMu.Lock()
	ocrDownloads[m.ID] = &downloadState{Downloading: false, Progress: 100, Received: total, Total: total}
	ocrMu.Unlock()
}

// HandleDeleteOcrModel removes a downloaded language pack.
func HandleDeleteOcrModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id, ok := decodeModelID(r)
	if !ok {
		http.Error(w, "A model id is required", http.StatusBadRequest)
		return
	}
	m, ok := findOcrModel(id)
	if !ok {
		http.Error(w, "Unknown language", http.StatusNotFound)
		return
	}
	if m.Bundled {
		http.Error(w, "The bundled English pack cannot be deleted", http.StatusBadRequest)
		return
	}

	ocrMu.Lock()
	if st, exists := ocrDownloads[m.ID]; exists && st.Downloading {
		ocrMu.Unlock()
		http.Error(w, "This language is currently downloading", http.StatusConflict)
		return
	}
	delete(ocrDownloads, m.ID)
	ocrMu.Unlock()

	p, err := ocrModelPath(m.ID)
	if err != nil {
		http.Error(w, "Could not resolve the language pack path", http.StatusInternalServerError)
		return
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		http.Error(w, "Could not delete the language pack", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"deleted"}`))
}

// HandleOcrLangData serves a downloaded language pack to the in-browser
// engine. The URL is /api/ocr/lang/<lang>.traineddata.gz.
func HandleOcrLangData(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/api/ocr/lang/")
	id := strings.TrimSuffix(name, ".traineddata.gz")
	m, ok := findOcrModel(id)
	if !ok || id == name { // unknown language or wrong extension
		http.Error(w, "Unknown language pack", http.StatusNotFound)
		return
	}
	p, err := ocrModelPath(m.ID)
	if err != nil {
		http.Error(w, "Could not resolve the language pack path", http.StatusInternalServerError)
		return
	}
	f, err := os.Open(p)
	if err != nil {
		http.Error(w, "Language pack not downloaded", http.StatusNotFound)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/gzip")
	io.Copy(w, f)
}
