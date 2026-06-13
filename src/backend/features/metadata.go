package features

import (
	"encoding/json"
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/bogem/id3v2/v2"
	"github.com/dhowden/tag"
	exif "github.com/dsoprea/go-exif/v3"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// Metadata Editor reads the real metadata embedded in a file and, where the
// format allows it, writes the edited values back and returns the modified
// file. Nothing is exported as a sidecar; the file itself is changed.
//
// Read support:  PDF (info dict), images (EXIF), audio (ID3/Vorbis/MP4 tags).
// Write support: PDF (Title/Author/Subject/Keywords/Creator + custom keys),
//                MP3 (ID3v2 title/artist/album/year/genre/comment),
//                images (strip all metadata by re-encoding).

type metadataField struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Editable bool   `json:"editable"`
}

type metadataResponse struct {
	Kind     string          `json:"kind"`     // pdf | image | audio | other
	Writable bool            `json:"writable"` // whether /api/metadata/apply works for this file
	Note     string          `json:"note,omitempty"`
	Fields   []metadataField `json:"fields"`
}

// pdfEditableKeys are the info-dict keys exposed as editable for PDFs.
var pdfEditableKeys = []string{"Title", "Author", "Subject", "Keywords", "Creator"}

// mp3EditableKeys are the ID3v2 frames exposed as editable for MP3s.
var mp3EditableKeys = []string{"Title", "Artist", "Album", "Year", "Genre"}

func metadataKind(name, contentType string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	switch ext {
	case "pdf":
		return "pdf"
	case "jpg", "jpeg", "png", "tif", "tiff", "webp", "heic", "gif", "bmp":
		return "image"
	case "mp3", "flac", "ogg", "m4a", "mp4", "aac", "wav", "opus":
		return "audio"
	}
	switch {
	case strings.HasPrefix(contentType, "image/"):
		return "image"
	case strings.HasPrefix(contentType, "audio/"), strings.HasPrefix(contentType, "video/"):
		return "audio"
	case contentType == "application/pdf":
		return "pdf"
	}
	return "other"
}

// receiveMetadataUpload stores the uploaded file in a temp dir, returning its
// path, original name and a cleanup func.
func receiveMetadataUpload(w http.ResponseWriter, r *http.Request) (path, name string, header *multipart.FileHeader, cleanup func(), ok bool) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return "", "", nil, nil, false
	}
	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return "", "", nil, nil, false
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "A file is required.", http.StatusBadRequest)
		return "", "", nil, nil, false
	}
	defer file.Close()

	dir, err := os.MkdirTemp(tempRoot(), "kit-metadata-*")
	if err != nil {
		http.Error(w, "Failed to create workspace", http.StatusInternalServerError)
		return "", "", nil, nil, false
	}
	cleanup = func() { os.RemoveAll(dir) }

	ext := sanitizeExt(strings.ToLower(filepath.Ext(hdr.Filename)))
	p := filepath.Join(dir, "input"+ext)
	out, err := os.Create(p)
	if err != nil {
		cleanup()
		http.Error(w, "Failed to store upload", http.StatusInternalServerError)
		return "", "", nil, nil, false
	}
	if _, err := io.Copy(out, file); err != nil {
		out.Close()
		cleanup()
		http.Error(w, "Failed to store upload", http.StatusInternalServerError)
		return "", "", nil, nil, false
	}
	out.Close()
	return p, hdr.Filename, hdr, cleanup, true
}

// HandleReadMetadata returns the metadata embedded in an uploaded file.
func HandleReadMetadata(w http.ResponseWriter, r *http.Request) {
	path, name, header, cleanup, ok := receiveMetadataUpload(w, r)
	if !ok {
		return
	}
	defer cleanup()

	kind := metadataKind(name, header.Header.Get("Content-Type"))
	resp := metadataResponse{Kind: kind}

	switch kind {
	case "pdf":
		fields, err := readPdfMetadata(path)
		if err != nil {
			http.Error(w, "Could not read this PDF's metadata. Encrypted PDFs must be decrypted first.", http.StatusBadRequest)
			return
		}
		resp.Fields = fields
		resp.Writable = true
		resp.Note = "Edits are written into the PDF's document information dictionary."
	case "image":
		resp.Fields = readImageMetadata(path)
		resp.Writable = true
		resp.Note = "Image metadata (EXIF) is read-only here, but you can strip all of it. Stripping re-encodes the image."
	case "audio":
		fields, writable := readAudioMetadata(path, name)
		resp.Fields = fields
		resp.Writable = writable
		if writable {
			resp.Note = "Edits are written as ID3v2 tags into the MP3."
		} else {
			resp.Note = "Tags for this format are read-only; editing is supported for MP3 files."
		}
	default:
		resp.Note = "No embedded metadata reader for this file type — showing basic file details only."
	}

	// Basic file details always come first.
	info, err := os.Stat(path)
	base := []metadataField{
		{Key: "File name", Value: name},
	}
	if err == nil {
		base = append(base, metadataField{Key: "Size", Value: fmt.Sprintf("%d bytes", info.Size())})
	}
	resp.Fields = append(base, resp.Fields...)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func readPdfMetadata(path string) ([]metadataField, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	info, err := api.PDFInfo(f, filepath.Base(path), nil, false, conf)
	if err != nil {
		return nil, err
	}

	fields := []metadataField{
		{Key: "Title", Value: info.Title, Editable: true},
		{Key: "Author", Value: info.Author, Editable: true},
		{Key: "Subject", Value: info.Subject, Editable: true},
		{Key: "Keywords", Value: strings.Join(info.Keywords, ", "), Editable: true},
		{Key: "Creator", Value: info.Creator, Editable: true},
		{Key: "Producer", Value: info.Producer},
		{Key: "Created", Value: info.CreationDate},
		{Key: "Modified", Value: info.ModificationDate},
		{Key: "Pages", Value: fmt.Sprintf("%d", info.PageCount)},
		{Key: "PDF version", Value: info.Version},
		{Key: "Encrypted", Value: fmt.Sprintf("%t", info.Encrypted)},
	}
	for k, v := range info.Properties {
		fields = append(fields, metadataField{Key: k, Value: v})
	}
	return fields, nil
}

func readImageMetadata(path string) []metadataField {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	rawExif, err := exif.SearchAndExtractExif(data)
	if err != nil {
		return []metadataField{{Key: "EXIF", Value: "No EXIF metadata found"}}
	}
	tags, _, err := exif.GetFlatExifData(rawExif, nil)
	if err != nil {
		return []metadataField{{Key: "EXIF", Value: "EXIF data could not be parsed"}}
	}
	fields := make([]metadataField, 0, len(tags))
	for _, t := range tags {
		value := t.FormattedFirst
		if len(value) > 200 {
			value = value[:200] + "…"
		}
		fields = append(fields, metadataField{Key: t.TagName, Value: value})
	}
	if len(fields) == 0 {
		fields = append(fields, metadataField{Key: "EXIF", Value: "No EXIF metadata found"})
	}
	return fields
}

func readAudioMetadata(path, name string) ([]metadataField, bool) {
	isMp3 := strings.EqualFold(filepath.Ext(name), ".mp3")

	f, err := os.Open(path)
	if err != nil {
		return nil, false
	}
	defer f.Close()

	m, err := tag.ReadFrom(f)
	if err != nil {
		if isMp3 {
			// A fresh MP3 with no tags yet is still editable.
			return []metadataField{
				{Key: "Title", Value: "", Editable: true},
				{Key: "Artist", Value: "", Editable: true},
				{Key: "Album", Value: "", Editable: true},
				{Key: "Year", Value: "", Editable: true},
				{Key: "Genre", Value: "", Editable: true},
			}, true
		}
		return []metadataField{{Key: "Tags", Value: "No tags found"}}, false
	}

	year := ""
	if m.Year() != 0 {
		year = fmt.Sprintf("%d", m.Year())
	}
	track, _ := m.Track()
	trackStr := ""
	if track != 0 {
		trackStr = fmt.Sprintf("%d", track)
	}
	fields := []metadataField{
		{Key: "Title", Value: m.Title(), Editable: isMp3},
		{Key: "Artist", Value: m.Artist(), Editable: isMp3},
		{Key: "Album", Value: m.Album(), Editable: isMp3},
		{Key: "Year", Value: year, Editable: isMp3},
		{Key: "Genre", Value: m.Genre(), Editable: isMp3},
		{Key: "Album artist", Value: m.AlbumArtist()},
		{Key: "Composer", Value: m.Composer()},
		{Key: "Track", Value: trackStr},
		{Key: "Tag format", Value: string(m.Format())},
	}
	return fields, isMp3
}

// HandleApplyMetadata writes edited metadata back into the file and returns
// the modified file as a download.
//
// Form fields:
//
//	file   - the file to modify
//	fields - JSON object of key -> new value (PDF and MP3)
//	action - "set" (default) or "strip" (images: remove all metadata)
func HandleApplyMetadata(w http.ResponseWriter, r *http.Request) {
	path, name, header, cleanup, ok := receiveMetadataUpload(w, r)
	if !ok {
		return
	}
	defer cleanup()

	kind := metadataKind(name, header.Header.Get("Content-Type"))
	action := strings.TrimSpace(r.FormValue("action"))

	var fields map[string]string
	if raw := r.FormValue("fields"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &fields); err != nil {
			http.Error(w, "Invalid fields payload.", http.StatusBadRequest)
			return
		}
	}

	switch kind {
	case "pdf":
		outPath := filepath.Join(filepath.Dir(path), "output.pdf")
		if err := applyPdfMetadata(path, outPath, fields); err != nil {
			fmt.Printf("pdf metadata error: %v\n", err)
			http.Error(w, "Could not update this PDF's metadata.", http.StatusBadRequest)
			return
		}
		sendFile(w, outPath, shared.SafeFileName(name), "application/pdf")
	case "audio":
		if !strings.EqualFold(filepath.Ext(name), ".mp3") {
			http.Error(w, "Editing tags is supported for MP3 files only.", http.StatusBadRequest)
			return
		}
		if err := applyMp3Metadata(path, fields); err != nil {
			fmt.Printf("mp3 metadata error: %v\n", err)
			http.Error(w, "Could not update this MP3's tags.", http.StatusBadRequest)
			return
		}
		sendFile(w, path, shared.SafeFileName(name), "audio/mpeg")
	case "image":
		if action != "strip" {
			http.Error(w, "Images support the \"strip all metadata\" action only.", http.StatusBadRequest)
			return
		}
		outPath, contentType, err := stripImageMetadata(path, name)
		if err != nil {
			http.Error(w, "Could not strip this image's metadata.", http.StatusBadRequest)
			return
		}
		sendFile(w, outPath, shared.SafeFileName(name), contentType)
	default:
		http.Error(w, "Writing metadata is not supported for this file type.", http.StatusBadRequest)
	}
}

func applyPdfMetadata(inPath, outPath string, fields map[string]string) error {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed

	set := map[string]string{}
	var remove []string
	for _, key := range pdfEditableKeys {
		value, present := fields[key]
		if !present {
			continue
		}
		if strings.TrimSpace(value) == "" {
			remove = append(remove, key)
		} else {
			set[key] = value
		}
	}

	current := inPath
	if len(remove) > 0 {
		removed := outPath + ".tmp"
		if err := api.RemovePropertiesFile(current, removed, remove, conf); err != nil {
			return err
		}
		current = removed
	}
	if len(set) > 0 {
		return api.AddPropertiesFile(current, outPath, set, conf)
	}
	if current == inPath {
		// Nothing to change: optimize-copy so the caller still gets a file.
		return api.OptimizeFile(inPath, outPath, conf)
	}
	return os.Rename(current, outPath)
}

func applyMp3Metadata(path string, fields map[string]string) error {
	tagFile, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return err
	}
	defer tagFile.Close()

	for _, key := range mp3EditableKeys {
		value, present := fields[key]
		if !present {
			continue
		}
		switch key {
		case "Title":
			tagFile.SetTitle(value)
		case "Artist":
			tagFile.SetArtist(value)
		case "Album":
			tagFile.SetAlbum(value)
		case "Year":
			tagFile.SetYear(value)
		case "Genre":
			tagFile.SetGenre(value)
		}
	}
	return tagFile.Save()
}

// stripImageMetadata re-encodes the image, which drops every metadata block
// (EXIF, GPS, XMP, thumbnails). JPEG output is re-encoded at high quality.
func stripImageMetadata(path, name string) (string, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", err
	}
	defer f.Close()

	img, srcFormat, err := safeDecodeImage(f)
	if err != nil {
		return "", "", err
	}

	format := normalizeOutputFormat("keep", srcFormat)
	contentType, ext := imageContentType(format)
	outPath := filepath.Join(filepath.Dir(path), "stripped."+ext)
	out, err := os.Create(outPath)
	if err != nil {
		return "", "", err
	}
	defer out.Close()
	if err := encodeImage(out, img, format, 95); err != nil {
		return "", "", err
	}
	return outPath, contentType, nil
}
