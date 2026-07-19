//go:build windows

package shared

import (
	"os/exec"
	"syscall"
)

// HideConsole keeps a child console program (ffmpeg, yt-dlp, reg, …) from
// flashing a terminal window: Kit itself is built with -H=windowsgui, and on
// Windows a console-less parent otherwise allocates a fresh visible console
// for every console child it spawns.
func HideConsole(cmd *exec.Cmd) {
	const createNoWindow = 0x08000000 // CREATE_NO_WINDOW
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
