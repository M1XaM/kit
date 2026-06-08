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

### 🔊 Audio Toolkit

* **Merge Audio** *(client)*: Add multiple audio files, preview and reorder them, then combine into one track — decoded, resampled and concatenated in-browser with the Web Audio API and exported as WAV or MP3. Fully offline, no uploads.
* **Record Video** *(client)*: Record your camera with a live preview, plus optional microphone and system audio (mixed together via the Web Audio API). Pause/resume, then preview and download each clip — nothing leaves your device.

### 🤖 AI Toolkit

Runs a neural-net model **locally** — no cloud, no uploads. Inference happens in a bundled engine (`kit-bgremove`) that ships inside the `lib/` folder next to the app, so there's nothing to install.

* **AI Remove Background** *(server)*: Cut the subject out of any image and download a transparent PNG. The feature page has a collapsible **live system monitor** (RAM, CPU, GPU with real-time graphs) and a model dropdown offering three tiers by resource cost — **U²-Net Lite** (~5 MB, runs anywhere), **ISNet General** (~176 MB), and **BiRefNet** (~900 MB, highest quality). The tier best suited to your machine is flagged **Recommended**, and a tier your machine can't handle is marked unavailable. Model weights are **downloaded on demand** from the page (so the base install stays small) and can be **deleted any time** to reclaim storage. Inference runs on your **NVIDIA GPU (CUDA)** when the GPU build is used and a compatible GPU is present, otherwise on the **CPU** — the result preview shows which one actually ran.

> **Availability & GPU builds:** every official release ships the **CPU** engine for **Linux, Windows and macOS (Apple Silicon)**, so background removal works out of the box on all three — no extra download beyond the model weights. Inference runs on the CPU by default; building with the GPU option (`make build with-gpu`) instead bundles the full CUDA + cuDNN runtime so any NVIDIA machine runs on the GPU with zero setup — at the cost of a much larger download (~2.9 GB per OS, which exceeds GitHub's 2 GB per-asset limit, so GPU bundles aren't attached to releases and are a build-from-source option). Without it (or on machines with no NVIDIA GPU) Kit automatically falls back to the CPU. If you build from source on a machine without a C/Go toolchain the sidecar is skipped and the feature reports itself as unavailable on the page.

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
