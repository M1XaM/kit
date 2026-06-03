package features

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

// makeTestPNG builds a small gradient PNG and returns its bytes.
func makeTestPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode test png: %v", err)
	}
	return buf.Bytes()
}

// multipartImageRequest builds a POST request with one or more image parts plus
// extra string form fields.
func multipartImageRequest(t *testing.T, field string, files map[string][]byte, fields map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for name, data := range files {
		part, err := mw.CreateFormFile(field, name)
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		part.Write(data)
	}
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	mw.Close()

	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// assertImageResponse checks the response is a 200 carrying a decodable image.
func assertImageResponse(t *testing.T, rec *httptest.ResponseRecorder) image.Image {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", rec.Code, rec.Body.String())
	}
	img, _, err := image.Decode(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("response is not a decodable image: %v", err)
	}
	return img
}

func TestHandleResizeImage_Fit(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"in.png": makeTestPNG(t, 200, 100)},
		map[string]string{"mode": "fit", "width": "100", "height": "100", "format": "png"})
	rec := httptest.NewRecorder()
	HandleResizeImage(rec, req)
	img := assertImageResponse(t, rec)
	// 200x100 fit into 100x100 -> 100x50 preserving aspect.
	if got := img.Bounds().Dx(); got != 100 {
		t.Errorf("width = %d, want 100", got)
	}
	if got := img.Bounds().Dy(); got != 50 {
		t.Errorf("height = %d, want 50", got)
	}
}

func TestHandleResizeImage_Percent(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"in.png": makeTestPNG(t, 200, 100)},
		map[string]string{"mode": "percent", "percent": "50", "format": "png"})
	rec := httptest.NewRecorder()
	HandleResizeImage(rec, req)
	img := assertImageResponse(t, rec)
	if img.Bounds().Dx() != 100 || img.Bounds().Dy() != 50 {
		t.Errorf("size = %v, want 100x50", img.Bounds())
	}
}

func TestHandleCompressImage_JPEG(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"in.png": makeTestPNG(t, 300, 300)},
		map[string]string{"format": "jpeg", "quality": "40"})
	rec := httptest.NewRecorder()
	HandleCompressImage(rec, req)
	assertImageResponse(t, rec)
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("content-type = %q, want image/jpeg", ct)
	}
}

func TestHandleImageBorder_RoundedIsTransparent(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"in.png": makeTestPNG(t, 100, 100)},
		map[string]string{"borderWidth": "10", "borderColor": "#ff0000", "cornerRadius": "30"})
	rec := httptest.NewRecorder()
	HandleImageBorder(rec, req)
	img := assertImageResponse(t, rec)
	if img.Bounds().Dx() != 120 || img.Bounds().Dy() != 120 {
		t.Fatalf("size = %v, want 120x120", img.Bounds())
	}
	// The extreme corner must be transparent due to rounding.
	_, _, _, a := img.At(0, 0).RGBA()
	if a != 0 {
		t.Errorf("top-left alpha = %d, want 0 (transparent corner)", a>>8)
	}
}

func TestHandleImageFilter_Grayscale(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"in.png": makeTestPNG(t, 50, 50)},
		map[string]string{"filter": "grayscale", "format": "png"})
	rec := httptest.NewRecorder()
	HandleImageFilter(rec, req)
	img := assertImageResponse(t, rec)
	// On a gray pixel R==G==B.
	r, g, b, _ := img.At(25, 25).RGBA()
	if r != g || g != b {
		t.Errorf("pixel not gray: r=%d g=%d b=%d", r>>8, g>>8, b>>8)
	}
}

func TestHandleImageFilter_Unknown(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"in.png": makeTestPNG(t, 10, 10)},
		map[string]string{"filter": "bogus"})
	rec := httptest.NewRecorder()
	HandleImageFilter(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for unknown filter", rec.Code)
	}
}

func TestHandleImageFilter_Blur(t *testing.T) {
	req := multipartImageRequest(t, "image",
		map[string][]byte{"in.png": makeTestPNG(t, 80, 80)},
		map[string]string{"filter": "blur", "amount": "5", "format": "png"})
	rec := httptest.NewRecorder()
	HandleImageFilter(rec, req)
	assertImageResponse(t, rec)
}

func TestHandleImageCollage_Grid(t *testing.T) {
	files := map[string][]byte{
		"a.png": makeTestPNG(t, 200, 100),
		"b.png": makeTestPNG(t, 100, 200),
		"c.png": makeTestPNG(t, 150, 150),
		"d.png": makeTestPNG(t, 120, 90),
	}
	req := multipartImageRequest(t, "files", files,
		map[string]string{"columns": "2", "tileWidth": "100", "tileHeight": "100", "spacing": "10", "background": "#000000", "format": "png"})
	rec := httptest.NewRecorder()
	HandleImageCollage(rec, req)
	img := assertImageResponse(t, rec)
	// 2 cols x 2 rows of 100px tiles with 10px gaps: 2*100 + 3*10 = 230.
	if img.Bounds().Dx() != 230 || img.Bounds().Dy() != 230 {
		t.Errorf("collage size = %v, want 230x230", img.Bounds())
	}
}

func TestHandleImageCollage_NeedsTwo(t *testing.T) {
	req := multipartImageRequest(t, "files",
		map[string][]byte{"a.png": makeTestPNG(t, 50, 50)},
		map[string]string{})
	rec := httptest.NewRecorder()
	HandleImageCollage(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for single image", rec.Code)
	}
}
