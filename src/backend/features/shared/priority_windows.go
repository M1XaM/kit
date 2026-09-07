//go:build windows

package shared

import (
	"os/exec"
	"syscall"
)

// belowNormalPriorityClass keeps a long job from competing with the desktop for
// CPU. Windows gives the foreground window only a modest scheduling boost, so a
// normal-priority process that saturates every core makes the whole machine
// feel slow — the cursor stutters and windows redraw late.
const belowNormalPriorityClass = 0x00004000 // BELOW_NORMAL_PRIORITY_CLASS

// StartBackground launches cmd at reduced priority. On Windows the priority
// class is chosen at creation time, so it applies from the child's very first
// instruction. Any flags HideConsole already set are preserved.
func StartBackground(cmd *exec.Cmd) error {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= belowNormalPriorityClass
	return cmd.Start()
}
