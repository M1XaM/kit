package main

import (
	"embed"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"strings"
	"time"
)

//go:embed frontend/dist/*
var embeddedFiles embed.FS

func init() {
	// On Windows, Go resolves MIME types from the registry, which is often
	// missing or wrong (.js as text/plain, .svg unset). With nosniff set, a
	// wrong type breaks scripts and the tab icon — so pin the ones we serve.
	for ext, typ := range map[string]string{
		".js":   "text/javascript",
		".css":  "text/css",
		".svg":  "image/svg+xml",
		".wasm": "application/wasm",
	} {
		mime.AddExtensionType(ext, typ)
	}
}

func setupServer(port string) *http.Server {
	security := newSecurityPolicy(port)

	distFS, err := fs.Sub(embeddedFiles, "frontend/dist")
	if err != nil {
		log.Fatalf("Failed to instantiate embedded FS: %v", err)
	}

	fileServer := http.FileServer(http.FS(distFS))
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		f, err := distFS.Open(path)
		if err == nil {
			f.Close()
			// Vite emits content-hashed filenames under assets/, so those are
			// safe to cache forever; everything else (index.html) stays fresh.
			if strings.HasPrefix(path, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		index, err := distFS.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer index.Close()
		http.ServeContent(w, r, "index.html", time.Time{}, index.(io.ReadSeeker))
	})

	mux.HandleFunc("/ws", security.wrapWebSocketHandler(handleWebSocket))

	setupAPI(mux, security, port)

	// No Addr here: main binds explicit loopback-only listeners and calls
	// Serve, so the API is never reachable from other machines on the network.
	return &http.Server{
		Handler: security.wrapRootHandler(mux),
		// ReadHeaderTimeout still guards against slow-header clients, but the
		// body Read/Write timeouts are left unset: video uploads can be large
		// and ffmpeg transcodes can run for minutes. Long-running handlers
		// bound their own work via a context deadline (see ffmpegTimeout).
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
}
