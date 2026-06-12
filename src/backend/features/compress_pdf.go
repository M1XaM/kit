package features

import (
	"context"
	"fmt"
	"io"
	"local-tools-hub/backend/features/shared"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// gsTimeout caps a single Ghostscript run so a malformed PDF can't hang the
// server.
const gsTimeout = 5 * time.Minute

// ghostscriptPath locates a Ghostscript binary. The executable name differs
// per platform: "gs" on Linux/macOS, "gswin64c"/"gswin32c" on Windows.
func ghostscriptPath() (string, bool) {
	candidates := []string{"gs"}
	if runtime.GOOS == "windows" {
		candidates = []string{"gswin64c", "gswin32c", "gs"}
	}
	for _, name := range candidates {
		if path, err := exec.LookPath(name); err == nil {
			return path, true
		}
	}
	return "", false
}

// gsPdfSettings maps the requested compression level to Ghostscript's preset
// profiles, which downsample embedded images — by far the biggest win.
func gsPdfSettings(level string) string {
	switch level {
	case "extreme":
		return "/screen" // 72 dpi images, smallest output
	case "low":
		return "/printer" // 300 dpi images, light compression
	default:
		return "/ebook" // 150 dpi images, recommended balance
	}
}

// HandleCompressPDF shrinks a PDF. When Ghostscript is installed its image
// downsampling gives real savings; otherwise pdfcpu's lossless optimization
// (dedup, stream recompression) is used. Whichever result is smallest — and
// actually smaller than the input — wins; if nothing helps, the original
// comes back unchanged rather than a "compressed" file that grew.
//
// Form fields:
//
//	file  - the PDF
//	level - low | medium (default) | extreme
func HandleCompressPDF(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(videoFormMemory); err != nil {
		http.Error(w, "Failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		file, header, err = r.FormFile("image")
	}
	if err != nil {
		file, header, err = r.FormFile("files")
	}
	if err != nil {
		http.Error(w, "PDF file is required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	workDir, err := os.MkdirTemp("", "pdf-compress-*")
	if err != nil {
		http.Error(w, "Failed to create workspace", http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(workDir)

	inputPath := filepath.Join(workDir, "input.pdf")
	inputFile, err := os.Create(inputPath)
	if err != nil {
		http.Error(w, "Failed to save uploaded file", http.StatusInternalServerError)
		return
	}
	if _, err := io.Copy(inputFile, file); err != nil {
		inputFile.Close()
		http.Error(w, "Failed to save uploaded file", http.StatusInternalServerError)
		return
	}
	inputFile.Close()

	inputSize := fileSize(inputPath)
	level := r.FormValue("level")

	// Candidate outputs, best (smallest valid) one wins.
	bestPath := inputPath
	bestSize := inputSize

	// 1. Ghostscript with image downsampling — the real compressor.
	if gsBin, ok := ghostscriptPath(); ok {
		gsOut := filepath.Join(workDir, "gs.pdf")
		ctx, cancel := context.WithTimeout(context.Background(), gsTimeout)
		cmd := exec.CommandContext(ctx, gsBin,
			"-sDEVICE=pdfwrite",
			"-dCompatibilityLevel=1.5",
			"-dPDFSETTINGS="+gsPdfSettings(level),
			"-dNOPAUSE", "-dQUIET", "-dBATCH", "-dSAFER",
			"-o", gsOut, inputPath,
		)
		if err := cmd.Run(); err != nil {
			fmt.Printf("ghostscript compress failed (falling back to pdfcpu): %v\n", err)
		} else if size := fileSize(gsOut); size > 0 && size < bestSize && pdfIsValid(gsOut) {
			bestPath, bestSize = gsOut, size
		}
		cancel()
	}

	// 2. pdfcpu lossless optimization — always available, modest savings.
	pdfcpuOut := filepath.Join(workDir, "optimized.pdf")
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	if err := api.OptimizeFile(inputPath, pdfcpuOut, conf); err != nil {
		fmt.Printf("pdfcpu optimize error: %v\n", err)
		if bestPath == inputPath {
			// Neither compressor could read it: report instead of echoing back.
			http.Error(w, "Failed to compress this PDF. Ensure it is a valid, unencrypted PDF.", http.StatusBadRequest)
			return
		}
	} else if size := fileSize(pdfcpuOut); size > 0 && size < bestSize {
		bestPath, bestSize = pdfcpuOut, size
	}

	out, err := os.Open(bestPath)
	if err != nil {
		http.Error(w, "Failed to open processed file", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Length", strconv.FormatInt(bestSize, 10))
	w.Header().Set("X-Original-Size", strconv.FormatInt(inputSize, 10))
	w.Header().Set("X-Compressed-Size", strconv.FormatInt(bestSize, 10))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="compressed_%s"`, shared.SafeFileName(header.Filename)))

	if _, err := io.Copy(w, out); err != nil {
		fmt.Printf("Error sending compressed PDF: %v\n", err)
	}
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

// pdfIsValid runs a relaxed pdfcpu validation so a corrupted Ghostscript
// output is never preferred just because it is smaller.
func pdfIsValid(path string) bool {
	conf := model.NewDefaultConfiguration()
	conf.ValidationMode = model.ValidationRelaxed
	return api.ValidateFile(path, conf) == nil
}
