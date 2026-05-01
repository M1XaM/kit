package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func isPortInUse(port string) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), time.Second)
	if err != nil {
		return false
	}
	if conn != nil {
		defer conn.Close()
		return true
	}
	return false
}

func chooseLaunchPort(basePort int) (int, bool) {
	port := basePort
	usedFallback := false

	if isPortInUse(strconv.Itoa(port)) {
		usedFallback = true
		port++
		for isPortInUse(strconv.Itoa(port)) {
			port++
		}
	}

	return port, usedFallback
}

func openBrowser(url string) error {
	var err error
	switch runtime.GOOS {
	case "linux":
		err = exec.Command("xdg-open", url).Run()
	case "windows":
		err = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Run()
	case "darwin":
		err = exec.Command("open", url).Run()
	default:
		err = fmt.Errorf("unsupported platform")
	}
	if err != nil {
		return err
	}
	return nil
}

func openBrowserWithRetry(url string, attempts int, delay time.Duration) {
	if attempts < 1 {
		attempts = 1
	}

	for i := 0; i < attempts; i++ {
		if err := openBrowser(url); err == nil {
			return
		} else if i == attempts-1 {
			log.Printf("Failed to open browser automatically after %d attempts: %v\n", attempts, err)
		}

		time.Sleep(delay)
	}
}

func waitForServerReady(url string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	client := &http.Client{
		Timeout: 500 * time.Millisecond,
	}

	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}

	return false
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
		desktopPath := filepath.Join(appDir, "kit.desktop")

		content := fmt.Sprintf(`[Desktop Entry]
Name=Kit
Exec=%s -term=%s %%u
Type=Application
Terminal=%s
MimeType=x-scheme-handler/kit;
`, exePath, termStr, termStr)
		existingContent, err := os.ReadFile(desktopPath)
		if err != nil || string(existingContent) != content {
			os.WriteFile(desktopPath, []byte(content), 0644)
			exec.Command("xdg-mime", "default", "kit.desktop", "x-scheme-handler/kit").Run()
			exec.Command("update-desktop-database", appDir).Run()
		}

	case "windows":
		// Check registry quickly so cmd windows don't flash if already present
		cmd := exec.Command("reg", "query", `HKCU\Software\Classes\kit\shell\open\command`, "/ve")
		out, err := cmd.Output()
		if err != nil || !strings.Contains(string(out), exePath) {
			exec.Command("reg", "add", `HKCU\Software\Classes\kit`, "/ve", "/d", "URL:Kit Protocol", "/f").Run()
			exec.Command("reg", "add", `HKCU\Software\Classes\kit`, "/v", "URL Protocol", "/d", "", "/f").Run()
			exec.Command("reg", "add", `HKCU\Software\Classes\kit\shell\open\command`, "/ve", "/d", fmt.Sprintf(`"%s" -term=%s "%%1"`, exePath, termStr), "/f").Run()
		}
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return
		}
		appPath := filepath.Join(home, "Applications", "Kit.app")
		contentsDir := filepath.Join(appPath, "Contents")
		macOSDir := filepath.Join(contentsDir, "MacOS")
		os.MkdirAll(macOSDir, 0755)

		wrapperPath := filepath.Join(macOSDir, "Kit")
		var wrapperContent string
		if showTerm {
			wrapperContent = fmt.Sprintf("#!/bin/bash\nopen -a Terminal \"%s\" --args -term=true \"$@\"", exePath)
		} else {
			wrapperContent = fmt.Sprintf("#!/bin/bash\n\"%s\" -term=false \"$@\"", exePath)
		}

		existingWrapper, err := os.ReadFile(wrapperPath)
		if err != nil || string(existingWrapper) != wrapperContent {
			os.WriteFile(wrapperPath, []byte(wrapperContent), 0755)
		}

		plistPath := filepath.Join(contentsDir, "Info.plist")
		plistContent := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>CFBundleIdentifier</key>
<string>com.kit.app</string>
<key>CFBundleName</key>
<string>Kit</string>
<key>CFBundleExecutable</key>
<string>Kit</string>
<key>CFBundleURLTypes</key>
<array>
<dict>
<key>CFBundleURLName</key>
<string>Kit</string>
<key>CFBundleURLSchemes</key>
<array>
<string>kit</string>
</array>
</dict>
</array>
</dict>
</plist>`

		existingPlist, err := os.ReadFile(plistPath)
		if err != nil || string(existingPlist) != plistContent {
			os.WriteFile(plistPath, []byte(plistContent), 0644)
		}
	}
}
