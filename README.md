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

---

## 📥 How to Run

1. **Launch:** Simply open the `bin/` folder and execute the `kit` binary corresponding to your operating system (`linux`, `windows`, or `macos`).
2. **Access:** The app will automatically open a sleek dashboard in your default web browser.
3. **Bookmark (Pro Tip):** Save `kit://start` as a bookmark to start the application natively whenever you need it!

---

## 🗑️ Uninstallation

Didn't like it? Kit leaves no hidden background services. To instantly wipe the custom `kit://` URL schemas from your system registries without any manual hunting:

1. Navigate to your operating system's folder inside `bin/`.
2. Run the `delete-kit` (or `delete-kit.exe`) application.
3. Your system is wiped clean of Kit's routing! You can safely delete all remaining files.
