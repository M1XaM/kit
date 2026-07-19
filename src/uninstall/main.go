package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"local-tools-hub/backend/features/shared"
)

// hiddenCommand builds a command that won't flash a console window on the
// windowsgui build; a no-op elsewhere.
func hiddenCommand(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	shared.HideConsole(cmd)
	return cmd
}

func askUser() bool {
	switch runtime.GOOS {
	case "windows":
		if _, err := exec.LookPath("powershell"); err == nil {
			cmd := hiddenCommand("powershell", "-Command", "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $res = [System.Windows.Forms.MessageBox]::Show('Are you sure you want to completely uninstall Kit?', 'Uninstall Kit', 'YesNo', 'Question'); if ($res -eq 'Yes') { exit 0 } else { exit 1 }")
			if err := cmd.Run(); err != nil {
				return false
			}
			return true
		}
	case "darwin":
		if _, err := exec.LookPath("osascript"); err == nil {
			cmd := exec.Command("osascript", "-e", `display dialog "Are you sure you want to completely uninstall Kit?" buttons {"Cancel", "Yes"} default button "Cancel" with title "Uninstall Kit"`)
			out, err := cmd.CombinedOutput()
			if err != nil {
				return false
			}
			return strings.Contains(string(out), "button returned:Yes")
		}
	case "linux":
		if _, err := exec.LookPath("zenity"); err == nil {
			cmd := exec.Command("zenity", "--question", "--text=Are you sure you want to completely uninstall Kit?", "--title=Uninstall Kit")
			if err := cmd.Run(); err != nil {
				return false
			}
			return true
		} else if _, err := exec.LookPath("kdialog"); err == nil {
			cmd := exec.Command("kdialog", "--yesno", "Are you sure you want to completely uninstall Kit?", "--title", "Uninstall Kit")
			if err := cmd.Run(); err != nil {
				return false
			}
			return true
		}
	}

	// Fallback to console input
	fmt.Print("Are you sure you want to completely uninstall Kit? (y/N): ")
	var response string
	fmt.Scanln(&response)
	return strings.ToLower(response) == "y" || strings.ToLower(response) == "yes"
}

func main() {
	if !askUser() {
		fmt.Println("Uninstallation cancelled.")
		return
	}

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
		cmd := hiddenCommand("reg", "delete", `HKCU\Software\Classes\kit`, "/f")
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

	// Remove the cache directory holding downloaded AI model weights (which can
	// be several GB). This mirrors modelsDir() in backend/features/ai_bgremove.go:
	// the weights live under <user cache>/kit/models, so wiping <user cache>/kit
	// reclaims that space and leaves no Kit data behind.
	removeModelCache()

	fmt.Println()
	fmt.Println("Kit uninstallation complete! You can now safely delete the executable binaries.")

	// The Windows binary is built windowsgui (no console), so console output is
	// invisible there — confirm completion with a dialog instead.
	if runtime.GOOS == "windows" {
		if _, err := exec.LookPath("powershell"); err == nil {
			hiddenCommand("powershell", "-Command", "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show('Kit uninstallation complete! You can now safely delete the executable binaries.', 'Uninstall Kit') | Out-Null").Run()
		}
	}
}

// removeModelCache deletes Kit's cache directory, including any downloaded
// background-removal model weights. It is best-effort: a missing directory is
// fine, and any other error is reported but does not fail the uninstall.
func removeModelCache() {
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	kitCache := filepath.Join(base, "kit")
	if _, err := os.Stat(kitCache); os.IsNotExist(err) {
		return
	}
	if err := os.RemoveAll(kitCache); err != nil {
		fmt.Printf("Could not remove downloaded model cache at %s: %v\n", kitCache, err)
		return
	}
	fmt.Println("Removed downloaded AI model weights and cache.")
}
