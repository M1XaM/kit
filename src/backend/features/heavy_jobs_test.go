package features

import (
	"context"
	"errors"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

// The pool size must always land in the documented 1–5 range regardless of the
// host's core count or RAM.
func TestHeavyJobLimitInRange(t *testing.T) {
	n := heavyJobLimit()
	if n < 1 || n > 5 {
		t.Fatalf("heavyJobLimit() = %d, want within [1,5]", n)
	}
}

// A cancelled context must abort the queue wait instead of running fn.
func TestRunHeavyJobRespectsCancelledContext(t *testing.T) {
	// Saturate the pool so the next acquire would block.
	sem := heavySemaphore()
	for i := 0; i < cap(sem); i++ {
		sem <- struct{}{}
	}
	defer func() {
		for i := 0; i < cap(sem); i++ {
			<-sem
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	ran := false
	err := runHeavyJob(ctx, func() error { ran = true; return nil })
	if ran {
		t.Error("fn ran despite a cancelled context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}

// The whole point of the cap is that a heavy job never claims every core, so
// the desktop keeps one to run on.
func TestHeavyJobThreadsLeavesACoreFree(t *testing.T) {
	n := heavyJobThreads()
	if n < 1 {
		t.Fatalf("heavyJobThreads() = %d, want at least 1", n)
	}
	if cores := runtime.NumCPU(); cores > 1 && n >= cores {
		t.Errorf("heavyJobThreads() = %d on a %d-core host, want fewer than every core", n, cores)
	}
}

// A process started through the pool must come back with the command's own exit
// status, not one swallowed by the priority handling.
func TestRunHeavyCmdReportsExitStatus(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no /bin/sh on Windows")
	}
	ctx := context.Background()

	if err := runHeavyCmd(ctx, exec.CommandContext(ctx, "/bin/sh", "-c", "exit 0")); err != nil {
		t.Errorf("a successful command reported %v", err)
	}
	if err := runHeavyCmd(ctx, exec.CommandContext(ctx, "/bin/sh", "-c", "exit 3")); err == nil {
		t.Error("a failing command reported success")
	}
	if err := runHeavyCmd(ctx, exec.CommandContext(ctx, "/definitely/not/a/binary")); err == nil {
		t.Error("a command that could not start reported success")
	}
}

// combinedOutputGated must still hand back stdout and stderr together, the way
// cmd.CombinedOutput() would.
func TestCombinedOutputGatedCapturesBothStreams(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no /bin/sh on Windows")
	}
	ctx := context.Background()
	out, err := combinedOutputGated(ctx, exec.CommandContext(ctx, "/bin/sh", "-c", "echo out; echo err 1>&2"))
	if err != nil {
		t.Fatalf("combinedOutputGated returned %v", err)
	}
	for _, want := range []string{"out", "err"} {
		if !strings.Contains(string(out), want) {
			t.Errorf("captured output %q is missing %q", out, want)
		}
	}
}
