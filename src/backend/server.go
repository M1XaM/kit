package main

import (
	"embed"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"
)

//go:embed frontend/dist/*
var embeddedFiles embed.FS

func setupServer(port string) *http.Server {
	security := newSecurityPolicy(port)

	distFS, err := fs.Sub(embeddedFiles, "frontend/dist")
	if err != nil {
		log.Fatalf("Failed to instantiate embedded FS: %v", err)
	}

	fileServer := http.FileServer(http.FS(distFS))
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		f, err := distFS.Open(path)
		if err == nil {
			f.Close()
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

	setupAPI(mux, security)

	return &http.Server{
		Addr:              ":" + port,
		Handler:           security.wrapRootHandler(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
}
