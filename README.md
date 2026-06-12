# Kit - Your Local Tools Hub

**Kit** brings all the tools you need to work with your files directly to your local machine. It provides a lightning-fast, sleek interface in your browser without sacrificing the power and security of a desktop application. 

Instead of uploading your sensitive files to random cloud websites for conversions or utility processing, **Kit** handles data manipulation entirely dynamically on your local OS. 

---

## 🚀 Why Use Kit? (Our Approach)

* **Privacy First (100% Offline):** Say goodbye to uploading your sensitive documents and images to third-party servers. Everything is processed locally on your hardware. No cloud servers, no bandwidth limits, no data harvesting.
* **Zero Browser Memory Overload:** Traditional web tools crash when handling large files because of browser sandbox limits. Kit uses a high-performance background server running directly on your OS to bypass these limits, letting you process massive files seamlessly.
* **Smart Background Auto-Shutdown:** Kit auto-detects lost connections. Close your browser tab, and the background engine cleanly terminates itself within 5 seconds to free up your system resources.
* **Native App Experience (`kit://` Protocol):** Kit runs in your browser but acts like a native OS application. Once launched, it registers a sleek `kit://start` custom URL scheme. You can bookmark this right in your browser to launch Kit instantly anytime!
* **Cross-Platform:** Works beautifully across Linux, macOS, and Windows.

---

## 🛠️ Existing Features

We are constantly expanding our toolkit. Currently, you can easily access the following modules right from the dashboard:

* **PNG to JPG Converter:** Convert bulky PNG images to compressed JPGs in seconds without quality loss.
* **Merge PDF:** Combine multiple PDFs in the exact order you want with the easiest PDF merger available.
* **Compress PDF:** Drastically reduce PDF file sizes while optimizing for maximal viewing quality.
* **PDF to Word:** Easily convert your PDF files into easy-to-edit DOC/DOCX documents.
* **PDF to Excel:** Pull data straight from your PDFs into Excel spreadsheets in a few short seconds.

### 🖼️ Image Toolkit

Heavy, whole-image work runs on the local Go engine so even large photos stay off the browser's memory budget; inherently interactive tools run entirely client-side for instant feedback with zero uploads.

* **Resize Image** *(server)*: Resize by exact dimensions, a fit-within box, or a percentage with high-quality Catmull-Rom resampling.
* **Compress Image** *(server)*: Shrink file size with an adjustable JPEG quality slider (or lossless PNG), optionally downscaling first.
* **Borders / Rounded Corners** *(server)*: Add a solid colored border and anti-aliased rounded corners, output as transparent PNG.
* **Filters / Effects** *(server)*: Grayscale, sepia, invert, brightness, contrast, saturation, blur and sharpen.
* **Image Collage / Grid** *(server)*: Arrange multiple images into a clean, evenly-spaced grid with a custom background.
* **Crop / Rotate / Flip** *(client)*: Draw a crop selection, rotate, and flip right on a `<canvas>` — nothing leaves your machine.
* **Color Palette Extraction** *(client)*: Pull a dominant color palette via median-cut quantization and copy the hex codes.
* **Convert Image Formats** *(server)*: Re-encode between PNG, JPEG, GIF, BMP and TIFF (WebP accepted as input).
* **Image Watermark** *(server)*: Stamp text (rendered with a bundled font — no system fonts needed) or a logo onto an image, with position presets, tiling and opacity.
* **Denoise / Enhance** *(server)*: One-click cleanup — edge-preserving noise reduction, auto-contrast histogram stretch and unsharp-mask sharpening with tuned defaults.

Every server-side image tool above also has a **Batch processing** checkbox: select up to 200 images, the same settings are applied to all of them and the results download as a ZIP.

### 🔊 Audio Toolkit

* **Merge Audio** *(client)*: Add multiple audio files, preview and reorder them, then combine into one track — decoded, resampled and concatenated in-browser with the Web Audio API and exported as WAV or MP3. Fully offline, no uploads.
* **Convert Audio Formats** *(server)*: Transcode between MP3, WAV, FLAC, OGG, Opus, M4A and AAC with an optional bitrate — video files work too, the audio track is extracted automatically.
* **Record Video** *(client)*: Record your camera with a live preview, plus optional microphone and system audio (mixed together via the Web Audio API). Pause/resume, then preview each clip — nothing leaves your device.
* **Screen Recording** *(client)*: Capture your screen, a window or a tab with optional system audio and microphone (mixed via the Web Audio API), with a live preview and pause/resume — fully offline.

All three recording tools offer **Save** (stores the clip under `data/<feature>/` next to the app) and **Save as…** (the browser's native save dialog).

* **YouTube Download** *(server)*: Paste one or many YouTube links, choose video+audio, audio-only (MP3) or video-only and a quality cap — Kit drives a locally installed **yt-dlp**; several links come back as one ZIP.
* **File Converter** *(server)*: The universal catch-all — images ↔ any image format or one combined PDF (drag rows to set the page order), audio ↔ any audio format, video ↔ any video format or audio-only extraction, and PDF → page images.

### 📄 Document & Text Toolkit

* **Notes** *(server)*: A persistent notepad with live **Markdown + LaTeX** rendering (KaTeX, in-browser). Every keystroke syncs to the local engine, so nothing is ever lost — notes are stored as **plain text files in `data/notes/`** right next to the app (alongside `bin` and `lib`), readable with any editor. Give a note an optional **name** (it becomes the file name, e.g. `Shopping list.txt`), archive it to the list below the editor, reopen any archived note to keep editing, or flip its **read-only lock** (a client-side guard) so you can't change it by accident.
* **Metadata Editor** *(server)*: Read the metadata actually embedded in a file and write your edits back into it — PDF info dictionary (Title/Author/Subject/Keywords/Creator), MP3 ID3 tags, and EXIF viewing plus one-click **strip all metadata** for images. No sidecar files; the modified file downloads directly.
* **Extract Text from PDF** *(client)*: Pull the text layer out of any PDF in-browser via the bundled PDF.js, with copy and .txt download. Scanned PDFs are pointed to the OCR tool.
* **Watermark Documents** *(server)*: Stamp text or an image above or behind the content of PDF pages, with opacity, rotation, color, font size and page-range control.

### 🤖 AI Toolkit

Runs a neural-net model **locally** — no cloud, no uploads. Inference happens in a bundled engine (`kit-bgremove`) that ships inside the `lib/` folder next to the app, so there's nothing to install.

* **AI Remove Background** *(server)*: Cut the subject out of any image and download a transparent PNG. The feature page has a collapsible **live system monitor** (RAM, CPU, GPU with real-time graphs) and a model dropdown offering three tiers by resource cost — **U²-Net Lite** (~5 MB, runs anywhere), **ISNet General** (~176 MB), and **BiRefNet** (~900 MB, highest quality). The tier best suited to your machine is flagged **Recommended**, and a tier your machine can't handle is marked unavailable. Model weights are **downloaded on demand** from the page (so the base install stays small) and can be **deleted any time** to reclaim storage. Inference runs on your **NVIDIA GPU (CUDA)** when the GPU build is used and a compatible GPU is present, otherwise on the **CPU** — the result preview shows which one actually ran.

* **AI Summarize** *(server)*: Condense long text into a short summary with a local sequence-to-sequence model. The feature page is a **two-pane editor** — paste text on the left, read the summary on the right — with the same **live system monitor** and a model dropdown offering three tiers — **T5 Small** (~310 MB, runs anywhere), **T5 Base** (~990 MB), and **FLAN-T5 Base** (~1.1 GB, instruction-tuned for the best quality). As with background removal, weights are **downloaded on demand**, can be **deleted any time**, the best tier for your machine is flagged **Recommended**, and inference uses your **GPU (CUDA)** when available else the **CPU** — the result shows which ran.

* **AI Paraphrase** *(server)*: Rewrite text with a local instruction-tuned model, **highlighting only the words you want changed**. Paste text on the left and load it into the **output editor** on the right, then **click individual words (or several in a row)** to highlight spans — only the highlighted spans are sent to the model and rewritten in place (everything else stays untouched). Two tiers — **FLAN-T5 Small** (~376 MB, runs anywhere) and **FLAN-T5 Base** (~1.1 GB, better, more varied rewrites). Same **live system monitor**, **Recommended** flag, **on-demand** weights you can **delete any time**, and **GPU/CPU** auto-selection as the other AI tools. (It shares the same local text engine as AI Summarize.)

* **OCR** *(client)*: Extract text from images and scans with Tesseract running entirely on your device — the engine, WASM core and English language pack ship inside Kit. **19 more languages** (Spanish, French, German, Russian, Chinese, …) download on demand from the page, are stored under `data/ocr-models/` and can be deleted any time — the same model-card flow as the other AI tools.

> **Availability & GPU builds:** every official release ships the **CPU** engine for **Linux, Windows and macOS (Apple Silicon)**, so the AI features work out of the box on all three — no extra download beyond the model weights. Inference runs on the CPU by default; building with the GPU option (`make build with-gpu`) instead bundles the full CUDA + cuDNN runtime so any NVIDIA machine runs on the GPU with zero setup — at the cost of a much larger download (~2.9 GB per OS, which exceeds GitHub's 2 GB per-asset limit, so GPU bundles aren't attached to releases and are a build-from-source option). Without it (or on machines with no NVIDIA GPU) Kit automatically falls back to the CPU. If you build from source on a machine without a C/Go toolchain the sidecar is skipped and the feature reports itself as unavailable on the page.

---

## 📥 How to Run

1. **Launch:** Open the `bin/` folder for your operating system (`linux`, `windows`, or `macos`) and execute the **`install-kit`** application. (Its bundled engine and libraries live in the adjacent `lib/` folder — keep them together.)
2. **Access:** The app will automatically open a sleek dashboard in your default web browser.
3. **Bookmark (Pro Tip):** Save `kit://start` as a bookmark to start the application natively whenever you need it!

Each OS folder contains `install-kit`, `uninstall-kit`, and a `lib/` folder with everything else.

---

## 🗑️ Uninstallation

Didn't like it? Kit leaves no hidden background services. To instantly wipe the custom `kit://` URL schemas from your system registries without any manual hunting:

1. Navigate to your operating system's folder inside `bin/`.
2. Run the **`uninstall-kit`** (or `uninstall-kit.exe`) application.
3. Your system is wiped clean of Kit's routing! You can safely delete all remaining files.
