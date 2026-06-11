package features

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Notes are stored as plain .txt files in data/notes/ next to the installed
// binary (alongside the lib/ folder), so users can read, grep or back them up
// with any tool. The editor syncs on every keystroke; writes are serialized
// and last-write-wins.
//
// A note's id is its filename without the .txt extension. Notes the user has
// named are stored under exactly that name ("Shopping list.txt"); unnamed
// notes fall back to a generated "note-<timestamp>.txt".

// noteMaxBytes caps a single note so a runaway client can't fill the disk.
const noteMaxBytes = 1 << 20

var (
	// Generated ids for unnamed notes.
	noteGeneratedPattern = regexp.MustCompile(`^note-\d+$`)
	// Characters that are unsafe in filenames on at least one supported OS.
	noteNameUnsafe = regexp.MustCompile(`[\x00-\x1f/\\:*?"<>|]+`)
	notesMu        sync.Mutex
)

type noteMeta struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Title    string `json:"title"`
	Preview  string `json:"preview"`
	Modified int64  `json:"modified"` // unix milliseconds
	Size     int64  `json:"size"`
}

// windowsReservedNames are device names Windows refuses (or worse, hangs on)
// as the part of a filename before the first dot, regardless of extension.
var windowsReservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// safeNoteName sanitizes a user-given note name for use as a filename. An
// empty result means "unnamed". Stripping path separators and trimming dots
// also makes the result safe against traversal.
func safeNoteName(name string) string {
	name = noteNameUnsafe.ReplaceAllString(name, " ")
	name = strings.Join(strings.Fields(name), " ")
	name = strings.Trim(name, ". ")
	stem, _, _ := strings.Cut(name, ".")
	if windowsReservedNames[strings.ToUpper(stem)] {
		name = "_" + name
	}
	return truncateRunes(name, 60)
}

// validNoteID reports whether an id received from the client is safe to use
// as a filename base: it must survive sanitization unchanged.
func validNoteID(id string) bool {
	return id != "" && safeNoteName(id) == id
}

// parseNoteFileName splits a filename into note id and optional display name.
// ok=false for files that are not notes (temp files, strays). Generated ids
// have no display name.
func parseNoteFileName(fileName string) (id, name string, ok bool) {
	base, found := strings.CutSuffix(fileName, ".txt")
	if !found || !validNoteID(base) {
		return "", "", false
	}
	if noteGeneratedPattern.MatchString(base) {
		return base, "", true
	}
	return base, base, true
}

// noteFileExists reports whether a note file for the id is present.
func noteFileExists(dir, id string) bool {
	st, err := os.Stat(filepath.Join(dir, id+".txt"))
	return err == nil && !st.IsDir()
}

// notesBaseDirOverride redirects note storage in tests.
var notesBaseDirOverride = ""

// notesDir resolves (and creates) the notes folder next to the executable,
// falling back to the working directory for dev builds run via `go run`.
func notesDir() (string, error) {
	base := ""
	if notesBaseDirOverride != "" {
		base = notesBaseDirOverride
	} else if exe, err := os.Executable(); err == nil {
		base = filepath.Dir(exe)
	} else if wd, err := os.Getwd(); err == nil {
		base = wd
	} else {
		return "", err
	}
	dir := filepath.Join(base, "data", "notes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

// noteTitleAndPreview derives a list title (first non-empty line) and a short
// body preview from the note text.
func noteTitleAndPreview(content string) (title, preview string) {
	title = "Untitled"
	rest := ""
	for i, line := range strings.Split(content, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			// Strip leading markdown markers (#, -, *, >) for a cleaner title.
			t = strings.TrimSpace(strings.TrimLeft(t, "#->* \t"))
			if t == "" {
				t = "Untitled"
			}
			title = truncateRunes(t, 80)
			rest = strings.Join(strings.Split(content, "\n")[i+1:], " ")
			break
		}
	}
	preview = truncateRunes(strings.Join(strings.Fields(rest), " "), 160)
	return title, preview
}

func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n-1]) + "…"
}

func writeNoteJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		fmt.Printf("notes: encode response error: %v\n", err)
	}
}

// HandleListNotes returns metadata for every stored note, newest first.
func HandleListNotes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	dir, err := notesDir()
	if err != nil {
		http.Error(w, "Failed to open the notes folder.", http.StatusInternalServerError)
		return
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		http.Error(w, "Failed to read the notes folder.", http.StatusInternalServerError)
		return
	}

	notes := make([]noteMeta, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		id, name, isNote := parseNoteFileName(entry.Name())
		if !isNote {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		title, preview := noteTitleAndPreview(string(content))
		if name != "" {
			// A user-given name takes priority; the whole body becomes preview.
			title = name
			preview = truncateRunes(strings.Join(strings.Fields(string(content)), " "), 160)
		}
		notes = append(notes, noteMeta{
			ID:       id,
			Name:     name,
			Title:    title,
			Preview:  preview,
			Modified: info.ModTime().UnixMilli(),
			Size:     info.Size(),
		})
	}
	sort.Slice(notes, func(i, j int) bool { return notes[i].Modified > notes[j].Modified })
	writeNoteJSON(w, map[string]any{"notes": notes})
}

// HandleGetNote returns the full content of one note.
func HandleGetNote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	dir, err := notesDir()
	if err != nil {
		http.Error(w, "Failed to open the notes folder.", http.StatusInternalServerError)
		return
	}
	id := r.URL.Query().Get("id")
	if !validNoteID(id) {
		http.Error(w, "Invalid note id.", http.StatusBadRequest)
		return
	}
	content, err := os.ReadFile(filepath.Join(dir, id+".txt"))
	if err != nil {
		http.Error(w, "Note not found.", http.StatusNotFound)
		return
	}
	_, name, _ := parseNoteFileName(id + ".txt")
	writeNoteJSON(w, map[string]any{
		"id":      id,
		"name":    name,
		"content": string(content),
	})
}

// uniqueNoteID resolves a filename collision: when another note already owns
// the desired id, a " (n)" suffix is appended. The note's own current id is
// never treated as a collision, so repeated saves stay stable.
func uniqueNoteID(dir, desired, currentID string) string {
	if desired == currentID || !noteFileExists(dir, desired) {
		return desired
	}
	for n := 2; ; n++ {
		candidate := fmt.Sprintf("%s (%d)", desired, n)
		if candidate == currentID || !noteFileExists(dir, candidate) {
			return candidate
		}
	}
}

// HandleSaveNote persists a note's full content, creating the note when no id
// is supplied. The editor calls this on every keystroke.
func HandleSaveNote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, noteMaxBytes+4096)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return
	}
	if len(req.Content) > noteMaxBytes {
		http.Error(w, "Note is too large (1 MB limit).", http.StatusRequestEntityTooLarge)
		return
	}

	dir, err := notesDir()
	if err != nil {
		http.Error(w, "Failed to open the notes folder.", http.StatusInternalServerError)
		return
	}

	notesMu.Lock()
	defer notesMu.Unlock()

	if req.ID != "" && !validNoteID(req.ID) {
		http.Error(w, "Invalid note id.", http.StatusBadRequest)
		return
	}
	name := safeNoteName(req.Name)

	// The note's id is its filename: the user-given name when present, a
	// generated one otherwise (also when a previously set name is cleared).
	desired := name
	if desired == "" {
		if noteGeneratedPattern.MatchString(req.ID) {
			desired = req.ID
		} else {
			desired = fmt.Sprintf("note-%d", time.Now().UnixNano())
		}
	}
	id := uniqueNoteID(dir, desired, req.ID)
	path := filepath.Join(dir, id+".txt")

	// Write to a temp file then rename so a crash mid-write can't corrupt the
	// note. Both live in the same directory, so the rename is atomic.
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		http.Error(w, "Failed to save the note.", http.StatusInternalServerError)
		return
	}
	if _, err := tmp.WriteString(req.Content); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		http.Error(w, "Failed to save the note.", http.StatusInternalServerError)
		return
	}
	tmp.Close()
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		http.Error(w, "Failed to save the note.", http.StatusInternalServerError)
		return
	}

	// Renaming a note leaves the file under its previous name; drop it.
	if req.ID != "" && req.ID != id {
		os.Remove(filepath.Join(dir, req.ID+".txt"))
	}

	_, displayName, _ := parseNoteFileName(id + ".txt")
	title, preview := noteTitleAndPreview(req.Content)
	if displayName != "" {
		// Same rule as the list endpoint: a user-given name takes priority and
		// the whole body becomes the preview.
		title = displayName
		preview = truncateRunes(strings.Join(strings.Fields(req.Content), " "), 160)
	}
	writeNoteJSON(w, map[string]any{
		"id":       id,
		"name":     displayName,
		"title":    title,
		"preview":  preview,
		"modified": time.Now().UnixMilli(),
	})
}

// HandleDeleteNote removes a note file permanently.
func HandleDeleteNote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil {
		http.Error(w, "Invalid request body.", http.StatusBadRequest)
		return
	}
	dir, err := notesDir()
	if err != nil {
		http.Error(w, "Failed to open the notes folder.", http.StatusInternalServerError)
		return
	}
	if !validNoteID(req.ID) {
		http.Error(w, "Invalid note id.", http.StatusBadRequest)
		return
	}

	notesMu.Lock()
	defer notesMu.Unlock()
	if err := os.Remove(filepath.Join(dir, req.ID+".txt")); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Note not found.", http.StatusNotFound)
			return
		}
		http.Error(w, "Failed to delete the note.", http.StatusInternalServerError)
		return
	}
	writeNoteJSON(w, map[string]any{"ok": true})
}
