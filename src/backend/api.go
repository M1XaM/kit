package main

import (
	"local-tools-hub/src/backend/features"
	"net/http"
)

func setupAPI(mux *http.ServeMux, policy *securityPolicy) {
	mux.HandleFunc("/api/convert/png-to-jpg", policy.wrapAPIHandler(features.HandlePngToJpg))
	mux.HandleFunc("/api/pdf/compress", policy.wrapAPIHandler(features.HandleCompressPDF))
}
