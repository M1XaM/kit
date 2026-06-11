// Command kit-bgremove is the AI background-removal sidecar for Kit.
//
// It is intentionally a separate binary from the main `kit` server: ONNX
// inference needs CGO + the ONNX Runtime shared library, while `kit` itself is
// built pure-static and cross-compiled. The server shells out to this tool
// (see features/ai_bgremove.go), passing a model file, a preprocessing profile,
// an input image and an output path. We run the saliency model, turn its mask
// into an alpha channel, and write a transparent-background PNG.
//
// Usage:
//
//	kit-bgremove --model <weights.onnx> --profile <u2net|isnet|birefnet> \
//	             --input <img> --output <out.png> [--provider cpu] [--ort-lib <path>]
package main

import (
	"flag"
	"fmt"
	"image"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"runtime"

	// Decoders for the input formats Kit accepts.
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"

	ort "github.com/yalue/onnxruntime_go"
)

// profile holds the per-model preprocessing parameters. These mirror the rembg
// session definitions for each model family.
type profile struct {
	size int
	mean [3]float32
	std  [3]float32
}

var profiles = map[string]profile{
	"u2net":    {size: 320, mean: [3]float32{0.485, 0.456, 0.406}, std: [3]float32{0.229, 0.224, 0.225}},
	"isnet":    {size: 1024, mean: [3]float32{0.5, 0.5, 0.5}, std: [3]float32{1.0, 1.0, 1.0}},
	"birefnet": {size: 1024, mean: [3]float32{0.485, 0.456, 0.406}, std: [3]float32{0.229, 0.224, 0.225}},
}

func main() {
	modelPath := flag.String("model", "", "path to the .onnx model file")
	profileName := flag.String("profile", "u2net", "preprocessing profile: u2net|isnet|birefnet")
	inputPath := flag.String("input", "", "path to the input image")
	outputPath := flag.String("output", "", "path to write the transparent PNG")
	provider := flag.String("provider", "auto", "execution provider: auto|cuda|cpu (auto tries the GPU, then falls back to CPU)")
	ortLib := flag.String("ort-lib", "", "path to the ONNX Runtime shared library")
	flag.Parse()

	if *modelPath == "" || *inputPath == "" || *outputPath == "" {
		fail("usage: --model and --input and --output are required")
	}
	prof, ok := profiles[*profileName]
	if !ok {
		fail("unknown profile %q", *profileName)
	}

	used, err := run(*modelPath, prof, *inputPath, *outputPath, *ortLib, *provider)
	if err != nil {
		fail("%v", err)
	}
	// The server reads this line to report which provider actually ran.
	fmt.Printf("KIT_PROVIDER=%s\n", used)
}

// providerOrder resolves the requested --provider into the list of providers to
// attempt, in order. "auto" tries the GPU first and falls back to CPU.
func providerOrder(requested string) []string {
	switch requested {
	case "cpu":
		return []string{"cpu"}
	case "cuda", "gpu":
		return []string{"cuda", "cpu"}
	default:
		return []string{"cuda", "cpu"}
	}
}

// buildSessionOptions returns SessionOptions configured for the given provider.
// For "cuda" it appends the CUDA execution provider (which errors here if the
// ONNX Runtime build or machine lacks CUDA/cuDNN, letting the caller fall back).
func buildSessionOptions(provider string) (*ort.SessionOptions, error) {
	opts, err := ort.NewSessionOptions()
	if err != nil {
		return nil, err
	}
	if provider == "cuda" {
		cudaOpts, err := ort.NewCUDAProviderOptions()
		if err != nil {
			opts.Destroy()
			return nil, err
		}
		defer cudaOpts.Destroy()
		_ = cudaOpts.Update(map[string]string{"device_id": "0"})
		if err := opts.AppendExecutionProviderCUDA(cudaOpts); err != nil {
			opts.Destroy()
			return nil, err
		}
		return opts, nil
	}
	// CPU: let ORT use all available cores.
	_ = opts.SetIntraOpNumThreads(runtime.NumCPU())
	return opts, nil
}

// run executes the model and returns which provider was actually used.
func run(modelPath string, prof profile, inputPath, outputPath, ortLib, provider string) (string, error) {
	src, err := loadImage(inputPath)
	if err != nil {
		return "", fmt.Errorf("read input: %w", err)
	}
	bounds := src.Bounds()
	origW, origH := bounds.Dx(), bounds.Dy()
	if origW == 0 || origH == 0 {
		return "", fmt.Errorf("input image is empty")
	}

	// Preprocess: resize to the model's square input and build an NCHW tensor.
	resized := image.NewRGBA(image.Rect(0, 0, prof.size, prof.size))
	draw.CatmullRom.Scale(resized, resized.Bounds(), src, bounds, draw.Over, nil)
	inputData := toTensor(resized, prof)

	// Initialize ONNX Runtime against the bundled shared library.
	if lib := resolveORTLib(ortLib); lib != "" {
		ort.SetSharedLibraryPath(lib)
	}
	if err := ort.InitializeEnvironment(); err != nil {
		return "", fmt.Errorf("init onnxruntime: %w", err)
	}
	defer ort.DestroyEnvironment()

	inputInfo, outputInfo, err := ort.GetInputOutputInfo(modelPath)
	if err != nil {
		return "", fmt.Errorf("inspect model: %w", err)
	}
	if len(inputInfo) == 0 || len(outputInfo) == 0 {
		return "", fmt.Errorf("model has no inputs/outputs")
	}
	inputName := inputInfo[0].Name
	outputName := outputInfo[0].Name

	inputTensor, err := ort.NewTensor(
		ort.NewShape(1, 3, int64(prof.size), int64(prof.size)), inputData)
	if err != nil {
		return "", fmt.Errorf("create input tensor: %w", err)
	}
	defer inputTensor.Destroy()

	// Try the requested providers in order (e.g. cuda then cpu) so a machine
	// without a working GPU stack still succeeds on the CPU.
	var session *ort.DynamicAdvancedSession
	var usedProvider string
	var lastErr error
	for _, p := range providerOrder(provider) {
		opts, err := buildSessionOptions(p)
		if err != nil {
			lastErr = err
			fmt.Fprintf(os.Stderr, "kit-bgremove: %s provider unavailable: %v\n", p, err)
			continue
		}
		s, err := ort.NewDynamicAdvancedSession(modelPath, []string{inputName}, []string{outputName}, opts)
		opts.Destroy()
		if err != nil {
			lastErr = err
			fmt.Fprintf(os.Stderr, "kit-bgremove: %s session failed: %v\n", p, err)
			continue
		}
		session = s
		usedProvider = p
		break
	}
	if session == nil {
		return "", fmt.Errorf("no usable execution provider: %w", lastErr)
	}
	defer session.Destroy()

	outputs := []ort.Value{nil}
	if err := session.Run([]ort.Value{inputTensor}, outputs); err != nil {
		return "", fmt.Errorf("inference: %w", err)
	}
	defer outputs[0].Destroy()

	maskTensor, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return "", fmt.Errorf("unexpected output type %T", outputs[0])
	}
	mask := maskTensor.GetData()
	mShape := maskTensor.GetShape()
	mh, mw := maskDims(mShape, prof.size)
	if len(mask) < mh*mw {
		return "", fmt.Errorf("mask smaller than expected")
	}

	// Some models emit raw logits rather than a [0,1] probability map: BiRefNet's
	// final sigmoid lives outside the exported ONNX graph. Squash those to
	// probabilities first — otherwise the min-max step below stretches the wide
	// logit range (e.g. -25..+17) across the full alpha range, pushing the
	// decision boundary to mid-gray and leaving backgrounds a semi-transparent
	// haze. U²-Net/ISNet already output [0,1] and are left untouched.
	maskToProb(mask)

	// Build the alpha channel: min-max normalize the mask, then resize it back
	// to the original dimensions and composite onto the source RGB.
	alpha := maskToAlpha(mask, mw, mh)
	fullAlpha := resizeGray(alpha, mw, mh, origW, origH)
	out := compose(src, fullAlpha, origW, origH)

	if err := writePNG(outputPath, out); err != nil {
		return "", err
	}
	return usedProvider, nil
}

// toTensor flattens an RGBA image into a normalized NCHW float32 buffer.
func toTensor(img *image.RGBA, prof profile) []float32 {
	size := prof.size
	data := make([]float32, 3*size*size)
	plane := size * size
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			i := img.PixOffset(x, y)
			r := float32(img.Pix[i]) / 255.0
			g := float32(img.Pix[i+1]) / 255.0
			b := float32(img.Pix[i+2]) / 255.0
			idx := y*size + x
			data[idx] = (r - prof.mean[0]) / prof.std[0]
			data[plane+idx] = (g - prof.mean[1]) / prof.std[1]
			data[2*plane+idx] = (b - prof.mean[2]) / prof.std[2]
		}
	}
	return data
}

// maskToProb maps a raw model mask to probabilities in-place when the model
// emits logits. A saliency probability map is bounded to [0,1]; anything outside
// that (allowing a tiny epsilon for numerical noise) is a logit map whose
// sigmoid wasn't baked into the ONNX graph — BiRefNet is the case here. We apply
// the logistic function so downstream min-max normalization keeps sharp edges
// instead of smearing the wide logit range into a gray haze. U²-Net and ISNet
// already output [0,1] and are left untouched.
func maskToProb(mask []float32) {
	const eps = 1e-3
	logits := false
	for _, v := range mask {
		if v < -eps || v > 1+eps {
			logits = true
			break
		}
	}
	if !logits {
		return
	}
	for i, v := range mask {
		mask[i] = float32(1.0 / (1.0 + math.Exp(float64(-v))))
	}
}

// maskDims pulls the height/width out of a mask shape like [1,1,H,W], falling
// back to the square model input size when the shape is unexpected.
func maskDims(shape ort.Shape, fallback int) (h, w int) {
	dims := []int64(shape)
	if n := len(dims); n >= 2 {
		return int(dims[n-2]), int(dims[n-1])
	}
	return fallback, fallback
}

// maskToAlpha min-max normalizes a single-channel mask to a 0..255 grayscale
// image so faint saliency maps still use the full alpha range.
func maskToAlpha(mask []float32, w, h int) *image.Gray {
	min, max := mask[0], mask[0]
	for i := 0; i < w*h; i++ {
		v := mask[i]
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	span := max - min
	g := image.NewGray(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		norm := float32(0)
		if span > 0 {
			norm = (mask[i] - min) / span
		}
		g.Pix[i] = uint8(clamp01(norm) * 255)
	}
	return g
}

// resizeGray scales a grayscale alpha map to the target dimensions.
func resizeGray(src *image.Gray, srcW, srcH, dstW, dstH int) *image.Gray {
	if srcW == dstW && srcH == dstH {
		return src
	}
	dst := image.NewGray(image.Rect(0, 0, dstW, dstH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)
	return dst
}

// compose builds the final transparent image from the source RGB and the alpha.
func compose(src image.Image, alpha *image.Gray, w, h int) *image.NRGBA {
	out := image.NewNRGBA(image.Rect(0, 0, w, h))
	b := src.Bounds()
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, bl, _ := src.At(b.Min.X+x, b.Min.Y+y).RGBA()
			o := out.PixOffset(x, y)
			out.Pix[o] = uint8(r >> 8)
			out.Pix[o+1] = uint8(g >> 8)
			out.Pix[o+2] = uint8(bl >> 8)
			out.Pix[o+3] = alpha.GrayAt(x, y).Y
		}
	}
	return out
}

func loadImage(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	return img, err
}

func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	return enc.Encode(f, img)
}

// resolveORTLib finds the ONNX Runtime shared library: an explicit path wins,
// otherwise look next to this executable (and a sibling lib/ dir), which is how
// Kit's release bundles it.
func resolveORTLib(explicit string) string {
	if explicit != "" {
		return explicit
	}
	var names []string
	switch runtime.GOOS {
	case "windows":
		names = []string{"onnxruntime.dll"}
	case "darwin":
		names = []string{"libonnxruntime.dylib"}
	default:
		names = []string{"libonnxruntime.so"}
	}
	dirs := []string{}
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		dirs = append(dirs, d, filepath.Join(d, "lib"))
	}
	for _, dir := range dirs {
		for _, n := range names {
			p := filepath.Join(dir, n)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	return ""
}

func clamp01(v float32) float32 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "kit-bgremove: "+format+"\n", args...)
	os.Exit(1)
}
