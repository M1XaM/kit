package main

import (
"embed"
"flag"
"fmt"
"image/jpeg"
"image/png"
"io/fs"
"log"
"net/http"
"os"
"os/exec"
"path/filepath"
"runtime"
"sync"
"time"

"github.com/gorilla/websocket"
)

//go:embed frontend/dist/*
var embeddedFiles embed.FS

var (
upgrader     = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
activeConns  = 0
connsMutex   sync.Mutex
shutdownChan = make(chan struct{})
)

func main() {
// Add flag handling
showTerm := flag.Bool("term", true, "Show terminal with logs when launched via URL scheme")
flag.Parse()

// Register OS handler using flag value
registerCustomScheme(*showTerm)

port := "8080"
url := fmt.Sprintf("http://localhost:%s", port)

distFS, err := fs.Sub(embeddedFiles, "frontend/dist")
if err != nil {
log.Fatalf("Failed to instantiate embedded FS: %v", err)
}

http.Handle("/", http.FileServer(http.FS(distFS)))
http.HandleFunc("/ws", handleWebSocket)
http.HandleFunc("/api/convert/png-to-jpg", handlePngToJpg)

server := &http.Server{Addr: ":" + port}

go func() {
fmt.Printf("Server listening on %s\n", url)
if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
log.Fatalf("Server error: %v", err)
}
}()

go openBrowser(url)

go func() {
zeroConnSince := time.Time{}
for {
time.Sleep(1 * time.Second)
connsMutex.Lock()
count := activeConns
connsMutex.Unlock()

if count == 0 {
if zeroConnSince.IsZero() {
zeroConnSince = time.Now()
} else if time.Since(zeroConnSince) > 5*time.Second {
fmt.Println("No active connections for 5 seconds. Shutting down...")
os.Exit(0)
}
} else {
zeroConnSince = time.Time{} // reset
}
}
}()

select {}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
conn, err := upgrader.Upgrade(w, r, nil)
if err != nil {
log.Println("WebSocket upgrade error:", err)
return
}
defer conn.Close()

connsMutex.Lock()
activeConns++
fmt.Printf("Client connected. Active connections: %d\n", activeConns)
connsMutex.Unlock()

defer func() {
connsMutex.Lock()
activeConns--
fmt.Printf("Client disconnected. Active connections: %d\n", activeConns)
connsMutex.Unlock()
}()

for {
_, _, err := conn.ReadMessage()
if err != nil {
break
}
}
}

func handlePngToJpg(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
return
}

err := r.ParseMultipartForm(50 << 20)
if err != nil {
http.Error(w, "Failed to parse form", http.StatusBadRequest)
return
}

file, header, err := r.FormFile("image")
if err != nil {
http.Error(w, "Image file is required", http.StatusBadRequest)
return
}
defer file.Close()

img, err := png.Decode(file)
if err != nil {
http.Error(w, "Failed to decode PNG. Ensure the file is a valid PNG.", http.StatusBadRequest)
return
}

w.Header().Set("Content-Type", "image/jpeg")
w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s.jpg\"", header.Filename))

opts := &jpeg.Options{Quality: 90}
err = jpeg.Encode(w, img, opts)
if err != nil {
http.Error(w, "Failed to encode JPEG", http.StatusInternalServerError)
return
}

fmt.Printf("Successfully converted %s from PNG to JPG\n", header.Filename)
}

func openBrowser(url string) {
var err error
switch runtime.GOOS {
case "linux":
err = exec.Command("xdg-open", url).Start()
case "windows":
err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
case "darwin":
err = exec.Command("open", url).Start()
default:
err = fmt.Errorf("unsupported platform")
}
if err != nil {
log.Printf("Failed to open browser automatically: %v\n", err)
}
}

func registerCustomScheme(showTerm bool) {
exePath, err := os.Executable()
if err != nil {
log.Printf("Failed to get executable path for registration: %v", err)
return
}
exePath, err = filepath.Abs(exePath)
if err != nil {
return
}

termStr := "false"
if showTerm {
termStr = "true"
}

switch runtime.GOOS {
case "linux":
home, err := os.UserHomeDir()
if err != nil {
return
}
appDir := filepath.Join(home, ".local", "share", "applications")
os.MkdirAll(appDir, 0755)
desktopPath := filepath.Join(appDir, "local-tools-hub.desktop")

content := fmt.Sprintf(`[Desktop Entry]
Name=Local Tools Hub
Exec=%s -term=true %%u
Type=Application
Terminal=%s
MimeType=x-scheme-handler/local-tools;
`, exePath, termStr)
os.WriteFile(desktopPath, []byte(content), 0644)
exec.Command("xdg-mime", "default", "local-tools-hub.desktop", "x-scheme-handler/local-tools").Run()
exec.Command("update-desktop-database", appDir).Run()

case "windows":
exec.Command("cmd", "/c", fmt.Sprintf("reg add \"HKCU\\Software\\Classes\\local-tools\" /ve /d \"URL:Local Tools Protocol\" /f")).Run()
exec.Command("cmd", "/c", fmt.Sprintf("reg add \"HKCU\\Software\\Classes\\local-tools\" /v \"URL Protocol\" /d \"\" /f")).Run()

// If term=true on Windows, don't use -H windowsgui when building. 
exec.Command("cmd", "/c", fmt.Sprintf("reg add \"HKCU\\Software\\Classes\\local-tools\\shell\\open\\command\" /ve /d \"\\\"%s\\\" -term=true \\\"%%1\\\"\" /f", exePath)).Run()

case "darwin":
home, err := os.UserHomeDir()
if err != nil {
return
}
appPath := filepath.Join(home, "Applications", "LocalToolsHub.app")
contentsDir := filepath.Join(appPath, "Contents")
macOSDir := filepath.Join(contentsDir, "MacOS")
os.MkdirAll(macOSDir, 0755)

wrapperPath := filepath.Join(macOSDir, "LocalToolsHub")

// On MacOS, to spawn a visible terminal rather than silent execution
var wrapperContent string
if showTerm {
wrapperContent = fmt.Sprintf("#!/bin/bash\nopen -a Terminal \"%s\" --args -term=true \"$@\"", exePath)
} else {
wrapperContent = fmt.Sprintf("#!/bin/bash\n\"%s\" -term=false \"$@\"", exePath)
}

os.WriteFile(wrapperPath, []byte(wrapperContent), 0755)

plistPath := filepath.Join(contentsDir, "Info.plist")
plistContent := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>CFBundleIdentifier</key>
<string>com.localtools.hub</string>
<key>CFBundleName</key>
<string>LocalToolsHub</string>
<key>CFBundleExecutable</key>
<string>LocalToolsHub</string>
<key>CFBundleURLTypes</key>
<array>
<dict>
<key>CFBundleURLName</key>
<string>Local Tools</string>
<key>CFBundleURLSchemes</key>
<array>
<string>local-tools</string>
</array>
</dict>
</array>
</dict>
</plist>`
os.WriteFile(plistPath, []byte(plistContent), 0644)

lsregister := "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
exec.Command(lsregister, "-f", appPath).Run()
}
}
