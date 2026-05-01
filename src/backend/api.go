package main

import (
	"local-tools-hub/backend/features"
	"net/http"
)

func setupAPI(mux *http.ServeMux, policy *securityPolicy) {
	mux.HandleFunc("/api/convert/png-to-jpg", policy.wrapAPIHandler(features.HandlePngToJpg))
	mux.HandleFunc("/api/pdf/compress", policy.wrapAPIHandler(features.HandleCompressPDF))
	mux.HandleFunc("/api/pdf/split", policy.wrapAPIHandler(features.HandleSplitPDF))
	mux.HandleFunc("/api/preferences/favorites", policy.wrapAPIHandler(handleFavoritesPreferences))
}
