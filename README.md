# Kit

Kit is a robust local-tools hub featuring a high-performance Go backend and a React/Vite frontend. Instead of uploading your large files to random cloud websites for conversions or utility processing, **Kit** handles data manipulation entirely dynamically on your local OS, bypassing the usual browser memory limits while keeping all your data fully secure.

## Features

- **PNG to JPG Converter:** Converts bulky images instantly with Zero Memory Overload.
- **Custom Protocol Scheme (`kit://start`):** Acts like a sleek native OS application. Once run, it registers itself on Linux, Windows, or macOS, letting you "bookmark" its trigger right inside your browser to start the app natively.
- **Zero Idle Memory:** Auto-detects lost WebSocket heartbeats. Shut down your browser tab, and the background server immediately destroys itself 5 seconds later.

## Structure

```
├── .gitignore
├── README.md
├── bin/          (Auto-generated execution folder)
│   ├── linux/
│   ├── macos/
│   └── windows/
└── src/
    ├── frontend/ (React UI + Vite configuration)
    ├── uninstall/ (Uninstaller script code)
    ├── main.go   (Go Backend server + handler logic)
    ├── go.mod    (Dependencies)
    └── build.sh  (Cross-compiler script)
```

## How to Build

1. Open your terminal in the `src/` directory.
2. Ensure you have Node (`npm`) and Go installed.
3. Run the automated script:
   ```bash
   ./build.sh
   ```

This creates the native backend and uninstaller apps for Linux, Windows, and macOS inside the `bin/` directory.

## Uninstallation

To instantly wipe the custom `kit://` URL schemes from your System registries without manual hunting:
1. Simply navigate to the `bin/{your-os}/` folder.
2. Execute `./delete-kit` (or `.exe`). 
3. After execution, safely throw away the binaries!
