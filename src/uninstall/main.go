package main

import (
"fmt"
"os"
"os/exec"
"path/filepath"
"runtime"
)

func main() {
fmt.Println("Removing all traces of Kit from the system...")

switch runtime.GOOS {
case "linux":
home, err := os.UserHomeDir()
if err == nil {
desktopPath := filepath.Join(home, ".local", "share", "applications", "kit.desktop")
appDir := filepath.Join(home, ".local", "share", "applications")

if _, err := os.Stat(desktopPath); err == nil {
os.Remove(desktopPath)
fmt.Println("Removed Linux .desktop shortcut.")
}

// Unregister mime route
exec.Command("xdg-mime", "default", "", "x-scheme-handler/kit").Run()
exec.Command("update-desktop-database", appDir).Run()
fmt.Println("Unregistered kit:// protocol hook from Ubuntu/Linux.")
}

case "windows":
// Force delete the registry keys without prompting
cmd := exec.Command("cmd", "/c", "reg delete \"HKCU\\Software\\Classes\\kit\" /f")
err := cmd.Run()
if err != nil {
fmt.Println("Could not find or remove Kit Registry Keys (they may already be removed).")
} else {
fmt.Println("Removed Windows Registry keys and kit:// protocol hook.")
}

case "darwin":
home, err := os.UserHomeDir()
if err == nil {
appPath := filepath.Join(home, "Applications", "Kit.app")

// Unregister with LaunchServices first
lsregister := "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
exec.Command(lsregister, "-u", appPath).Run()

// Delete the mock .app
if _, err := os.Stat(appPath); err == nil {
os.RemoveAll(appPath)
fmt.Println("Unregistered kit:// protocol and removed macOS mock App bundle.")
}
}
default:
fmt.Println("Unsupported OS.")
}

fmt.Println()
fmt.Println("Kit uninstallation complete! You can now safely delete the executable binaries.")
}
