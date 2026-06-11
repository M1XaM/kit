package main

import (
	"fmt"
	"local-tools-hub/backend/features"
	"net/http"
	"sync"
	"time"
)

func setupAPI(mux *http.ServeMux, policy *securityPolicy, port string) {
	mux.HandleFunc("/api/convert/png-to-jpg", policy.wrapAPIHandler(features.HandlePngToJpg))
	mux.HandleFunc("/api/convert/image-to-pdf", policy.wrapAPIHandler(features.HandleImagesToPDF))
	mux.HandleFunc("/api/convert/pdf-to-images", policy.wrapAPIHandler(features.HandlePdfToImages))
	mux.HandleFunc("/api/image/resize", policy.wrapAPIHandler(features.HandleResizeImage))
	mux.HandleFunc("/api/image/compress", policy.wrapAPIHandler(features.HandleCompressImage))
	mux.HandleFunc("/api/image/border", policy.wrapAPIHandler(features.HandleImageBorder))
	mux.HandleFunc("/api/image/filter", policy.wrapAPIHandler(features.HandleImageFilter))
	mux.HandleFunc("/api/image/collage", policy.wrapAPIHandler(features.HandleImageCollage))
	mux.HandleFunc("/api/image/convert", policy.wrapAPIHandler(features.HandleConvertImage))
	mux.HandleFunc("/api/image/watermark", policy.wrapAPIHandler(features.HandleImageWatermark))
	mux.HandleFunc("/api/image/enhance", policy.wrapAPIHandler(features.HandleEnhanceImage))
	mux.HandleFunc("/api/image/batch", policy.wrapAPIHandler(features.HandleBatchImage))
	mux.HandleFunc("/api/pdf/compress", policy.wrapAPIHandler(features.HandleCompressPDF))
	mux.HandleFunc("/api/pdf/split", policy.wrapAPIHandler(features.HandleSplitPDF))
	mux.HandleFunc("/api/pdf/merge", policy.wrapAPIHandler(features.HandleMergePDF))
	mux.HandleFunc("/api/pdf/extract-pages", policy.wrapAPIHandler(features.HandleExtractPages))
	mux.HandleFunc("/api/pdf/delete-pages", policy.wrapAPIHandler(features.HandleDeletePages))
	mux.HandleFunc("/api/pdf/reorder-pages", policy.wrapAPIHandler(features.HandleReorderPages))
	mux.HandleFunc("/api/pdf/rotate", policy.wrapAPIHandler(features.HandleRotatePDF))
	mux.HandleFunc("/api/pdf/protect", policy.wrapAPIHandler(features.HandleProtectPDF))
	mux.HandleFunc("/api/pdf/watermark", policy.wrapAPIHandler(features.HandleWatermarkPDF))
	mux.HandleFunc("/api/archive/extract", policy.wrapAPIHandler(features.HandleArchiveExtract))
	mux.HandleFunc("/api/archive/create", policy.wrapAPIHandler(features.HandleArchiveCreate))
	mux.HandleFunc("/api/video/trim", policy.wrapAPIHandler(features.HandleTrimVideo))
	mux.HandleFunc("/api/video/split", policy.wrapAPIHandler(features.HandleSplitVideo))
	mux.HandleFunc("/api/video/merge", policy.wrapAPIHandler(features.HandleMergeVideo))
	mux.HandleFunc("/api/video/resize", policy.wrapAPIHandler(features.HandleResizeVideo))
	mux.HandleFunc("/api/video/compress", policy.wrapAPIHandler(features.HandleCompressVideo))
	mux.HandleFunc("/api/video/convert", policy.wrapAPIHandler(features.HandleConvertVideo))
	mux.HandleFunc("/api/audio/trim", policy.wrapAPIHandler(features.HandleTrimAudio))
	mux.HandleFunc("/api/audio/adjust", policy.wrapAPIHandler(features.HandleAdjustAudio))
	mux.HandleFunc("/api/audio/convert", policy.wrapAPIHandler(features.HandleConvertAudio))
	mux.HandleFunc("/api/ai/models", policy.wrapAPIHandler(features.HandleListBgModels))
	mux.HandleFunc("/api/ai/models/download", policy.wrapAPIHandler(features.HandleDownloadBgModel))
	mux.HandleFunc("/api/ai/models/delete", policy.wrapAPIHandler(features.HandleDeleteBgModel))
	mux.HandleFunc("/api/ai/remove-background", policy.wrapAPIHandler(features.HandleRemoveBackground))
	mux.HandleFunc("/api/ai/summarize/models", policy.wrapAPIHandler(features.HandleListSummModels))
	mux.HandleFunc("/api/ai/summarize/models/download", policy.wrapAPIHandler(features.HandleDownloadSummModel))
	mux.HandleFunc("/api/ai/summarize/models/delete", policy.wrapAPIHandler(features.HandleDeleteSummModel))
	mux.HandleFunc("/api/ai/summarize", policy.wrapAPIHandler(features.HandleSummarize))
	mux.HandleFunc("/api/ai/paraphrase/models", policy.wrapAPIHandler(features.HandleListParaModels))
	mux.HandleFunc("/api/ai/paraphrase/models/download", policy.wrapAPIHandler(features.HandleDownloadParaModel))
	mux.HandleFunc("/api/ai/paraphrase/models/delete", policy.wrapAPIHandler(features.HandleDeleteParaModel))
	mux.HandleFunc("/api/ai/paraphrase", policy.wrapAPIHandler(features.HandleParaphrase))
	mux.HandleFunc("/api/notes/list", policy.wrapAPIHandler(features.HandleListNotes))
	mux.HandleFunc("/api/notes/get", policy.wrapAPIHandler(features.HandleGetNote))
	mux.HandleFunc("/api/notes/save", policy.wrapAPIHandler(features.HandleSaveNote))
	mux.HandleFunc("/api/notes/delete", policy.wrapAPIHandler(features.HandleDeleteNote))
	mux.HandleFunc("/api/system/metrics", policy.wrapAPIHandler(handleSystemMetrics))
	// /api/open — opens a browser tab on the running server.
	// Called by kit://start when an instance is already listening on the base port.
	mux.HandleFunc("/api/open", handleOpenTab(port))
}

func handleOpenTab(port string) http.HandlerFunc {
	var (
		mu       sync.Mutex
		lastOpen time.Time
	)
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
		// The legitimate caller is a freshly launched Kit process (plain Go
		// http.Get: no Origin, no Sec-Fetch-Site). A browser page on another
		// site can still fire a no-CORS GET at this endpoint, so reject
		// anything that identifies as a cross-site browser request.
		if r.Header.Get("Origin") != "" {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		if sfs := r.Header.Get("Sec-Fetch-Site"); sfs != "" && sfs != "same-origin" && sfs != "none" {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		// Rate-limit so a misbehaving caller can't spam browser tabs. Still
		// answer "ok" so a second Kit launch recognizes us and exits cleanly.
		mu.Lock()
		tooSoon := time.Since(lastOpen) < 2*time.Second
		if !tooSoon {
			lastOpen = time.Now()
		}
		mu.Unlock()
		if !tooSoon {
			url := fmt.Sprintf("http://localhost:%s", port)
			go openBrowserWithRetry(url, 3, 400*time.Millisecond)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}
}
