package features

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupNotesDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	notesBaseDirOverride = dir
	t.Cleanup(func() { notesBaseDirOverride = "" })
	return filepath.Join(dir, "data", "notes")
}

func saveNote(t *testing.T, id, name, content string) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"id": id, "name": name, "content": content})
	req := httptest.NewRequest(http.MethodPost, "/api/notes/save", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	HandleSaveNote(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("save (id=%q name=%q) returned %d: %s", id, name, rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("save response is not JSON: %v", err)
	}
	return resp
}

func TestSaveNoteUnnamedUsesGeneratedID(t *testing.T) {
	dir := setupNotesDir(t)

	resp := saveNote(t, "", "", "scratch text")
	id, _ := resp["id"].(string)
	if !noteGeneratedPattern.MatchString(id) {
		t.Fatalf("unnamed note got id %q, want generated note-<ts>", id)
	}
	if resp["name"] != "" {
		t.Fatalf("unnamed note got name %q, want empty", resp["name"])
	}
	if _, err := os.Stat(filepath.Join(dir, id+".txt")); err != nil {
		t.Fatalf("note file missing: %v", err)
	}
}

func TestSaveNoteNamedUsesNameAsFileName(t *testing.T) {
	dir := setupNotesDir(t)

	resp := saveNote(t, "", "Shopping list", "- milk")
	if resp["id"] != "Shopping list" {
		t.Fatalf("named note got id %q, want %q", resp["id"], "Shopping list")
	}
	content, err := os.ReadFile(filepath.Join(dir, "Shopping list.txt"))
	if err != nil {
		t.Fatalf("named note file missing: %v", err)
	}
	if string(content) != "- milk" {
		t.Fatalf("file content = %q, want %q", content, "- milk")
	}
}

func TestSaveNoteNameCollisionGetsSuffixAndStaysStable(t *testing.T) {
	dir := setupNotesDir(t)

	saveNote(t, "", "Shopping list", "first")
	resp := saveNote(t, "", "Shopping list", "second")
	if resp["id"] != "Shopping list (2)" {
		t.Fatalf("colliding note got id %q, want %q", resp["id"], "Shopping list (2)")
	}

	// Re-saving the suffixed note with the same desired name must keep its id
	// rather than bumping the suffix on every keystroke.
	resp = saveNote(t, "Shopping list (2)", "Shopping list", "second v2")
	if resp["id"] != "Shopping list (2)" {
		t.Fatalf("re-save moved id to %q, want stable %q", resp["id"], "Shopping list (2)")
	}

	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		t.Fatalf("expected 2 note files, found %d", len(entries))
	}
}

func TestSaveNoteRenameDropsOldFile(t *testing.T) {
	dir := setupNotesDir(t)

	saveNote(t, "", "Old name", "body")
	resp := saveNote(t, "Old name", "New name", "body")
	if resp["id"] != "New name" {
		t.Fatalf("rename produced id %q, want %q", resp["id"], "New name")
	}
	if _, err := os.Stat(filepath.Join(dir, "Old name.txt")); !os.IsNotExist(err) {
		t.Fatalf("old file still present after rename")
	}
	if _, err := os.Stat(filepath.Join(dir, "New name.txt")); err != nil {
		t.Fatalf("new file missing after rename: %v", err)
	}
}

func TestSaveNoteClearingNameFallsBackToGeneratedID(t *testing.T) {
	dir := setupNotesDir(t)

	saveNote(t, "", "Named", "body")
	resp := saveNote(t, "Named", "", "body")
	id, _ := resp["id"].(string)
	if !noteGeneratedPattern.MatchString(id) {
		t.Fatalf("cleared name produced id %q, want generated note-<ts>", id)
	}
	if _, err := os.Stat(filepath.Join(dir, "Named.txt")); !os.IsNotExist(err) {
		t.Fatalf("named file still present after clearing the name")
	}
}

func TestSaveNoteSanitizesUnsafeNames(t *testing.T) {
	setupNotesDir(t)

	resp := saveNote(t, "", `a/b\c:d*e?f"g<h>i|j`, "body")
	id, _ := resp["id"].(string)
	if strings.ContainsAny(id, `/\:*?"<>|`) {
		t.Fatalf("sanitized id still contains unsafe characters: %q", id)
	}
}

func TestGetNoteRejectsTraversal(t *testing.T) {
	setupNotesDir(t)

	req := httptest.NewRequest(http.MethodGet, "/api/notes/get?id="+
		strings.ReplaceAll("../../etc/passwd", "/", "%2F"), nil)
	rec := httptest.NewRecorder()
	HandleGetNote(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("traversal id returned %d, want 400", rec.Code)
	}
}

func TestDeleteNoteRemovesFile(t *testing.T) {
	dir := setupNotesDir(t)

	saveNote(t, "", "Doomed", "body")
	body, _ := json.Marshal(map[string]string{"id": "Doomed"})
	req := httptest.NewRequest(http.MethodPost, "/api/notes/delete", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	HandleDeleteNote(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete returned %d: %s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "Doomed.txt")); !os.IsNotExist(err) {
		t.Fatalf("file still present after delete")
	}
}

func TestListNotesUsesNameAsTitle(t *testing.T) {
	setupNotesDir(t)

	saveNote(t, "", "Groceries", "- milk\n- eggs")
	saveNote(t, "", "", "# Derived title\nbody")

	req := httptest.NewRequest(http.MethodGet, "/api/notes/list", nil)
	rec := httptest.NewRecorder()
	HandleListNotes(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list returned %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Notes []noteMeta `json:"notes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("list response is not JSON: %v", err)
	}
	if len(resp.Notes) != 2 {
		t.Fatalf("expected 2 notes, got %d", len(resp.Notes))
	}
	titles := map[string]bool{}
	for _, n := range resp.Notes {
		titles[n.Title] = true
	}
	if !titles["Groceries"] || !titles["Derived title"] {
		t.Fatalf("unexpected titles: %v", titles)
	}
}
