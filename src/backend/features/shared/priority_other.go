//go:build !windows

package shared

import (
	"os/exec"
	"syscall"
)

// backgroundNice mirrors the "below normal" priority class used on Windows:
// enough that the desktop keeps its responsiveness, not so much that a job
// crawls on an otherwise idle machine.
const backgroundNice = 5

// StartBackground launches cmd at reduced priority. Unix has no way to set a
// nice value at creation time, so it is applied right after the fork — the
// child spends only microseconds at normal priority. Lowering a process's own
// priority never needs privileges, and a job that stays at normal priority is
// still correct, so a failure here isn't worth reporting.
func StartBackground(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	if cmd.Process != nil {
		_ = syscall.Setpriority(syscall.PRIO_PROCESS, cmd.Process.Pid, backgroundNice)
	}
	return nil
}
