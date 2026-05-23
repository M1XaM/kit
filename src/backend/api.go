package main

import (
	"fmt"
	"local-tools-hub/backend/features"
	"net/http"
	"time"
)

func setupAPI(mux *http.ServeMux, policy *securityPolicy, port string) {
	mux.HandleFunc("/api/convert/png-to-jpg", policy.wrapAPIHandler(features.HandlePngToJpg))
	mux.HandleFunc("/api/pdf/compress", policy.wrapAPIHandler(features.HandleCompressPDF))
	mux.HandleFunc("/api/pdf/split", policy.wrapAPIHandler(features.HandleSplitPDF))
	mux.HandleFunc("/api/archive/extract", policy.wrapAPIHandler(features.HandleArchiveExtract))
	mux.HandleFunc("/api/archive/create", policy.wrapAPIHandler(features.HandleArchiveCreate))
	mux.HandleFunc("/api/system/metrics", policy.wrapAPIHandler(handleSystemMetrics))
	// /api/open — opens a browser tab on the running server.
	// Called by kit://start when an instance is already listening on the base port.
	mux.HandleFunc("/api/open", handleOpenTab(port))
}

func handleOpenTab(port string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// Only accept requests from localhost.
		if r.Host != "localhost:"+port && r.Host != "127.0.0.1:"+port && r.Host != "[::1]:"+port {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		url := fmt.Sprintf("http://localhost:%s", port)
		go openBrowserWithRetry(url, 3, 400*time.Millisecond)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}
}
