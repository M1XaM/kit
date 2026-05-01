package features

import (
	"fmt"
	"image/jpeg"
	"image/png"
	"local-tools-hub/backend/features/shared"
	"net/http"
)

func HandlePngToJpg(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	err := r.ParseMultipartForm(50 << 20)
	if err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		http.Error(w, "Image file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	img, err := png.Decode(file)
	if err != nil {
		http.Error(w, "Failed to decode PNG. Ensure the file is a valid PNG.", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.jpg\"", shared.SafeFileBase(header.Filename)))

	opts := &jpeg.Options{Quality: 90}
	err = jpeg.Encode(w, img, opts)
	if err != nil {
		http.Error(w, "Failed to encode JPEG", http.StatusInternalServerError)
		return
	}

	fmt.Printf("Successfully converted %s from PNG to JPG\n", header.Filename)
}
