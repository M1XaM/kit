# Kit - Your Local Tools Hub

**Kit** brings all the tools you need to work with your files directly to your local machine. It provides a lightning-fast, sleek interface in your browser without sacrificing the power and security of a desktop application.

Instead of uploading your sensitive files to random cloud websites for conversions or utility processing, **Kit** handles data manipulation entirely on your local OS.

---

## 🚀 Why Use Kit?

* **Privacy First (100% Offline):** Your files never leave your hardware. No cloud servers, no bandwidth limits, no data harvesting.
* **Zero Browser Memory Overload:** A high-performance background engine on your OS handles the heavy lifting, so gigabyte videos and massive PDFs sail past the browser limits that crash ordinary web tools.
* **Smart Auto-Shutdown:** Close the browser tab and the background engine cleanly terminates itself within seconds to free up resources.
* **Native App Experience (`kit://` Protocol):** Runs in your browser but launches like a native OS application — bookmark `kit://start` to open Kit instantly.
* **Cross-Platform:** Works across Linux, macOS, and Windows.

---

## 🛠️ Features

50+ tools in one searchable dashboard, grouped by category:

### 🖼️ Image
Resize Image · Compress Image · Crop/Rotate/Flip · Color Palette Extraction · Image Collage/Grid · Borders/Rounded Corners · Filters/Effects · Convert Image Formats · Denoise/Enhance · Image Watermark · PNG to JPG

### 📄 Documents (PDF)
Merge PDF · Compress PDF · Split PDF · Encrypt/Decrypt PDF · Extract Pages · Delete Pages · Reorder Pages · Rotate Pages · File Converter

### ✍️ Text
Notes · Extract Text from PDF · Watermark Documents · Metadata Editor · Text Diff/Compare · Markdown Preview/Diff · Hash Generator · Base64 Encode/Decode · Hex Encode/Decode · URL Encode/Decode · Text Encoding Conversion

### 🔊 Audio
Record Audio · Merge Audio · Trim Audio · Adjust Bitrate/Sample Rate · Convert Audio Formats

### 🎬 Video & Recording
Record Video · Screen Recording · Trim Video · Cut/Split Video · Merge Video Clips · Resize Video · Compress Video · Convert Video Formats · YouTube Download

### 🤖 AI (runs locally)
AI Remove Background · AI Summarize · AI Paraphrase · OCR

### 🗜️ Files
Archive Create · Archive Extract · Checksum Verification

### 📊 System
Performance Viewer · Internet Speed

---

## 📥 Install & Run

It's a download-and-launch — no build steps, no package managers, nothing to compile.

1. Open the **[Releases](https://github.com/M1XaM/kit/releases/latest)** page and download the latest build for your OS (Linux, Windows, or macOS).
2. Unpack it and open the folder for your operating system inside `bin/`.
3. Run **`install-kit`** — Kit launches a dashboard in your default browser automatically.
4. *(Optional)* Bookmark `kit://start` to relaunch Kit natively anytime.

Each OS folder contains `install-kit`, `uninstall-kit`, and a `lib/` folder with the bundled engine — keep them together.

> Releases ship the **CPU** AI engine for Linux, Windows and macOS (Apple Silicon), so every feature works out of the box. GPU (CUDA) builds are a build-from-source option (`make build with-gpu`).

---

## 🗑️ Uninstallation

Kit leaves no hidden background services. To wipe the custom `kit://` URL scheme from your system:

1. Navigate to your operating system's folder inside `bin/`.
2. Run **`uninstall-kit`** (or `uninstall-kit.exe`).
3. Your system is wiped clean of Kit's routing — you can safely delete the remaining files.
</content>
