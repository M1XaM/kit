//go:build !windows

package shared

import "os/exec"

// HideConsole is a no-op outside Windows; see hide_console_windows.go.
func HideConsole(cmd *exec.Cmd) {}
