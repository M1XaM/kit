package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const maxFavoriteTools = 128

var favoritesFileMu sync.Mutex

type favoritesPayload struct {
	Order []string `json:"order"`
}

func handleFavoritesPreferences(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handleGetFavorites(w)
	case http.MethodPost:
		handleSaveFavorites(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleGetFavorites(w http.ResponseWriter) {
	order, err := readFavoritesOrder()
	if err != nil {
		http.Error(w, "Failed to load favorites", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(favoritesPayload{Order: order})
}

func handleSaveFavorites(w http.ResponseWriter, r *http.Request) {
	var payload favoritesPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	order := sanitizeFavoriteOrder(payload.Order)
	if len(order) > maxFavoriteTools {
		http.Error(w, "Too many favorite tools", http.StatusBadRequest)
		return
	}

	if err := writeFavoritesOrder(order); err != nil {
		http.Error(w, "Failed to save favorites", http.StatusInternalServerError)
		return
	}

	// Notify all connected tabs so every client stays in sync.
	go BroadcastFavoritesUpdated()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(favoritesPayload{Order: order})
}

func readFavoritesOrder() ([]string, error) {
	favoritesFileMu.Lock()
	defer favoritesFileMu.Unlock()

	path, err := favoritesFilePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		return nil, err
	}

	var payload favoritesPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return []string{}, nil
	}
	return sanitizeFavoriteOrder(payload.Order), nil
}

func writeFavoritesOrder(order []string) error {
	favoritesFileMu.Lock()
	defer favoritesFileMu.Unlock()

	path, err := favoritesFilePath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	payload := favoritesPayload{Order: sanitizeFavoriteOrder(order)}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(path), "favorites-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		_ = os.Remove(tmpPath)
		return err
	}
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}

	return os.Rename(tmpPath, path)
}

func favoritesFilePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "kit", "favorites.json"), nil
}

func sanitizeFavoriteOrder(order []string) []string {
	seen := make(map[string]struct{}, len(order))
	out := make([]string, 0, len(order))

	for _, id := range order {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
