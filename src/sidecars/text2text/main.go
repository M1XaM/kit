// Command kit-text2text is the AI text-to-text sidecar for Kit: a generic T5
// sequence-to-sequence engine shared by the AI Summarize and AI Paraphrase
// features (see features/ai_summarize.go and features/ai_paraphrase.go). The
// only difference between those features is the model weights and the task
// prefix ("summarize: " vs "paraphrase: "), so they share one binary.
//
// Like kit-bgremove it is a separate CGO binary that dlopen's ONNX Runtime, so
// it can't live in the pure-static `kit` server; the server shells out to it.
// For each input it:
//
//  1. tokenizes with the model's tokenizer.json (Unigram SentencePiece for T5),
//  2. runs the ONNX *encoder* once to get the hidden states,
//  3. runs the ONNX *decoder* autoregressively (greedy), feeding back each
//     predicted token until it emits EOS or hits the length cap,
//  4. detokenizes the generated ids back into text.
//
// In --batch mode the input/output files are JSON arrays of strings, so several
// segments (e.g. the phrases a user selected to paraphrase) are processed with a
// single model load. Without it, input/output are plain text (one document).
//
// Usage:
//
//	kit-text2text --encoder enc.onnx --decoder dec.onnx --tokenizer tokenizer.json \
//	              --input in.txt --output out.txt \
//	              [--prefix "summarize: "] [--batch] [--provider cpu] [--max-new 160]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/sugarme/tokenizer"
	"github.com/sugarme/tokenizer/pretrained"
	ort "github.com/yalue/onnxruntime_go"
)

type config struct {
	encoder, decoder, tokenizer string
	input, output               string
	provider, ortLib            string
	prefix                      string
	batch                       bool
	maxSource, maxNewTokens     int
	decoderStartID, eosID       int
}

func main() {
	var cfg config
	flag.StringVar(&cfg.encoder, "encoder", "", "path to encoder_model.onnx")
	flag.StringVar(&cfg.decoder, "decoder", "", "path to decoder_model.onnx")
	flag.StringVar(&cfg.tokenizer, "tokenizer", "", "path to the HuggingFace tokenizer.json")
	flag.StringVar(&cfg.input, "input", "", "path to the input (plain text, or a JSON array with --batch)")
	flag.StringVar(&cfg.output, "output", "", "path to write the output (plain text, or a JSON array with --batch)")
	flag.StringVar(&cfg.provider, "provider", "auto", "execution provider: auto|cuda|cpu")
	flag.StringVar(&cfg.ortLib, "ort-lib", "", "path to the ONNX Runtime shared library")
	flag.StringVar(&cfg.prefix, "prefix", "summarize: ", "task prefix prepended to each input (T5 expects this)")
	flag.BoolVar(&cfg.batch, "batch", false, "treat input/output as JSON arrays of strings (multiple segments, one model load)")
	flag.IntVar(&cfg.maxSource, "max-source", 512, "max input tokens fed to the encoder")
	flag.IntVar(&cfg.maxNewTokens, "max-new", 160, "max tokens to generate per input")
	flag.IntVar(&cfg.decoderStartID, "decoder-start", 0, "decoder start token id (T5 uses the pad id, 0)")
	flag.IntVar(&cfg.eosID, "eos", 1, "end-of-sequence token id (T5 uses 1)")
	flag.Parse()

	if cfg.encoder == "" || cfg.decoder == "" || cfg.tokenizer == "" || cfg.input == "" || cfg.output == "" {
		fail("usage: --encoder, --decoder, --tokenizer, --input and --output are required")
	}

	inputs, err := readInputs(cfg)
	if err != nil {
		fail("%v", err)
	}

	outputs, used, err := run(cfg, inputs)
	if err != nil {
		fail("%v", err)
	}

	if err := writeOutputs(cfg, outputs); err != nil {
		fail("write output: %v", err)
	}
	// The server reads this line to report which provider actually ran.
	fmt.Printf("KIT_PROVIDER=%s\n", used)
}

// readInputs loads the input file as one document (plain) or many segments (batch).
func readInputs(cfg config) ([]string, error) {
	raw, err := os.ReadFile(cfg.input)
	if err != nil {
		return nil, fmt.Errorf("read input: %w", err)
	}
	if cfg.batch {
		var segs []string
		if err := json.Unmarshal(raw, &segs); err != nil {
			return nil, fmt.Errorf("parse batch input: %w", err)
		}
		return segs, nil
	}
	return []string{string(raw)}, nil
}

func writeOutputs(cfg config, outputs []string) error {
	if cfg.batch {
		b, err := json.Marshal(outputs)
		if err != nil {
			return err
		}
		return os.WriteFile(cfg.output, b, 0o644)
	}
	text := ""
	if len(outputs) > 0 {
		text = outputs[0]
	}
	return os.WriteFile(cfg.output, []byte(text), 0o644)
}

// providerOrder resolves --provider into the providers to attempt, in order.
// "auto" tries the GPU first and falls back to CPU.
func providerOrder(requested string) []string {
	switch requested {
	case "cpu":
		return []string{"cpu"}
	default: // auto | cuda | gpu
		return []string{"cuda", "cpu"}
	}
}

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
	// CPU: leave a core for everything else. Claiming every one of them makes
	// the desktop stutter for as long as inference runs, and ORT gains very
	// little from that last thread.
	_ = opts.SetIntraOpNumThreads(cpuThreads())
	return opts, nil
}

// cpuThreads is the inference thread budget: every logical core but one, and
// never fewer than one. It mirrors heavyJobThreads in the Kit backend, which
// bounds ffmpeg the same way.
func cpuThreads() int {
	if n := runtime.NumCPU() - 1; n > 0 {
		return n
	}
	return 1
}

// run loads the model once and processes every input, returning the outputs and
// the provider that actually ran (trying cuda then cpu).
func run(cfg config, inputs []string) ([]string, string, error) {
	tk, err := pretrained.FromFile(cfg.tokenizer)
	if err != nil {
		return nil, "", fmt.Errorf("load tokenizer: %w", err)
	}

	if lib := resolveORTLib(cfg.ortLib); lib != "" {
		ort.SetSharedLibraryPath(lib)
	}
	if err := ort.InitializeEnvironment(); err != nil {
		return nil, "", fmt.Errorf("init onnxruntime: %w", err)
	}
	defer ort.DestroyEnvironment()

	encIn, encOut, err := ort.GetInputOutputInfo(cfg.encoder)
	if err != nil {
		return nil, "", fmt.Errorf("inspect encoder: %w", err)
	}
	decIn, decOut, err := ort.GetInputOutputInfo(cfg.decoder)
	if err != nil {
		return nil, "", fmt.Errorf("inspect decoder: %w", err)
	}
	if len(encOut) == 0 || len(decOut) == 0 {
		return nil, "", fmt.Errorf("model has no outputs")
	}
	io := modelIO{
		encInNames: names(encIn), encOutName: encOut[0].Name,
		decInNames: names(decIn), decOutName: decOut[0].Name,
	}

	var lastErr error
	for _, p := range providerOrder(cfg.provider) {
		outputs, err := runProvider(p, cfg, tk, io, inputs)
		if err == nil {
			return outputs, p, nil
		}
		lastErr = err
		fmt.Fprintf(os.Stderr, "kit-text2text: %s provider failed: %v\n", p, err)
	}
	return nil, "", fmt.Errorf("no usable execution provider: %w", lastErr)
}

type modelIO struct {
	encInNames []string
	encOutName string
	decInNames []string
	decOutName string
}

// runProvider builds the encoder/decoder sessions once for a provider and runs
// every input through them. Failing here (e.g. CUDA unavailable) lets run() fall
// back to the next provider.
func runProvider(provider string, cfg config, tk *tokenizer.Tokenizer, io modelIO, inputs []string) ([]string, error) {
	encOpts, err := buildSessionOptions(provider)
	if err != nil {
		return nil, err
	}
	enc, err := ort.NewDynamicAdvancedSession(cfg.encoder, io.encInNames, []string{io.encOutName}, encOpts)
	encOpts.Destroy()
	if err != nil {
		return nil, err
	}
	defer enc.Destroy()

	decOpts, err := buildSessionOptions(provider)
	if err != nil {
		return nil, err
	}
	dec, err := ort.NewDynamicAdvancedSession(cfg.decoder, io.decInNames, []string{io.decOutName}, decOpts)
	decOpts.Destroy()
	if err != nil {
		return nil, err
	}
	defer dec.Destroy()

	outputs := make([]string, len(inputs))
	for i, text := range inputs {
		if strings.TrimSpace(text) == "" {
			outputs[i] = strings.TrimSpace(text)
			continue
		}
		out, err := generate(cfg, tk, io, enc, dec, text)
		if err != nil {
			return nil, err
		}
		outputs[i] = out
	}
	return outputs, nil
}

// generate runs the encode→greedy-decode pipeline for one input on already-built
// sessions.
func generate(cfg config, tk *tokenizer.Tokenizer, io modelIO,
	enc, dec *ort.DynamicAdvancedSession, text string) (string, error) {

	// Tokenize "<prefix><text>". addSpecialTokens=true applies the model's
	// post-processor, which appends EOS for T5. Truncate to the context window.
	encoded, err := tk.EncodeSingle(cfg.prefix+strings.TrimSpace(text), true)
	if err != nil {
		return "", fmt.Errorf("tokenize: %w", err)
	}
	raw := encoded.GetIds()
	ids := make([]int64, len(raw))
	for i, id := range raw {
		ids[i] = int64(id)
	}
	if len(ids) > cfg.maxSource {
		ids = ids[:cfg.maxSource]
		ids[len(ids)-1] = int64(cfg.eosID)
	}
	srcLen := len(ids)
	mask := make([]int64, srcLen)
	for i := range mask {
		mask[i] = 1
	}

	idsTensor, err := ort.NewTensor(ort.NewShape(1, int64(srcLen)), ids)
	if err != nil {
		return "", err
	}
	maskTensor, err := ort.NewTensor(ort.NewShape(1, int64(srcLen)), mask)
	if err != nil {
		idsTensor.Destroy()
		return "", err
	}
	defer maskTensor.Destroy() // reused as the decoder's encoder_attention_mask

	encInputs, err := assemble(io.encInNames, map[string]ort.Value{
		"input_ids":      idsTensor,
		"attention_mask": maskTensor,
	})
	if err != nil {
		idsTensor.Destroy()
		return "", err
	}
	encOutputs := []ort.Value{nil}
	runErr := enc.Run(encInputs, encOutputs)
	idsTensor.Destroy()
	if runErr != nil {
		return "", fmt.Errorf("encoder: %w", runErr)
	}
	encHidden := encOutputs[0]
	defer encHidden.Destroy()

	decIDs := []int64{int64(cfg.decoderStartID)}
	generated := make([]int, 0, cfg.maxNewTokens)
	for step := 0; step < cfg.maxNewTokens; step++ {
		stepIDs, err := ort.NewTensor(ort.NewShape(1, int64(len(decIDs))), decIDs)
		if err != nil {
			return "", err
		}
		decInputs, err := assemble(io.decInNames, map[string]ort.Value{
			"input_ids":              stepIDs,
			"encoder_attention_mask": maskTensor,
			"encoder_hidden_states":  encHidden,
		})
		if err != nil {
			stepIDs.Destroy()
			return "", err
		}
		decOutputs := []ort.Value{nil}
		runErr := dec.Run(decInputs, decOutputs)
		stepIDs.Destroy()
		if runErr != nil {
			return "", fmt.Errorf("decoder: %w", runErr)
		}
		logits, ok := decOutputs[0].(*ort.Tensor[float32])
		if !ok {
			decOutputs[0].Destroy()
			return "", fmt.Errorf("unexpected decoder output type %T", decOutputs[0])
		}
		dims := []int64(logits.GetShape())
		data := logits.GetData()
		if len(dims) < 2 {
			logits.Destroy()
			return "", fmt.Errorf("unexpected logits shape %v", dims)
		}
		L := int(dims[len(dims)-2])
		V := int(dims[len(dims)-1])
		next := argmax(data[(L-1)*V : L*V])
		logits.Destroy()

		if next == cfg.eosID {
			break
		}
		generated = append(generated, next)
		decIDs = append(decIDs, int64(next))
	}

	return strings.TrimSpace(tk.Decode(generated, true)), nil
}

// assemble orders the values to match the model's declared input order. It
// errors if the model expects an input we don't provide (e.g. a KV-cache branch
// from a "merged" decoder export — we use the plain decoder_model.onnx instead).
func assemble(order []string, vals map[string]ort.Value) ([]ort.Value, error) {
	out := make([]ort.Value, len(order))
	for i, n := range order {
		v, ok := vals[n]
		if !ok {
			return nil, fmt.Errorf("model expects unsupported input %q", n)
		}
		out[i] = v
	}
	return out, nil
}

func names(info []ort.InputOutputInfo) []string {
	out := make([]string, len(info))
	for i, in := range info {
		out[i] = in.Name
	}
	return out
}

func argmax(v []float32) int {
	best := 0
	for i := 1; i < len(v); i++ {
		if v[i] > v[best] {
			best = i
		}
	}
	return best
}

// resolveORTLib finds the ONNX Runtime shared library next to this executable
// (and a sibling lib/ dir), matching how Kit's release bundles it.
func resolveORTLib(explicit string) string {
	if explicit != "" {
		return explicit
	}
	var nameList []string
	switch runtime.GOOS {
	case "windows":
		nameList = []string{"onnxruntime.dll"}
	case "darwin":
		nameList = []string{"libonnxruntime.dylib"}
	default:
		nameList = []string{"libonnxruntime.so"}
	}
	dirs := []string{}
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		dirs = append(dirs, d, filepath.Join(d, "lib"))
	}
	for _, dir := range dirs {
		for _, n := range nameList {
			p := filepath.Join(dir, n)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	return ""
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "kit-text2text: "+format+"\n", args...)
	os.Exit(1)
}
