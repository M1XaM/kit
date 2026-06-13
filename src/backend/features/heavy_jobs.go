package features

import (
	"context"
	"os/exec"
	"runtime"
	"sync"

	"github.com/shirou/gopsutil/v4/mem"
)

// Heavy tools shell out to CPU/GPU-intensive external processes — ffmpeg,
// Ghostscript, the PDF rasterizers, the AI sidecars and yt-dlp. Each one can
// already saturate several cores, so letting an unbounded number run at once
// (a burst of requests, or one impatient page firing many jobs) just thrashes
// the machine and makes every job slower. A small semaphore caps how many run
// concurrently; the rest queue.

var (
	heavyOnce sync.Once
	heavySem  chan struct{}
)

// heavyJobLimit scales the cap to the machine's real capabilities: about half
// the logical cores (each heavy job is itself multi-threaded), further bounded
// by RAM (budget ~2 GB per concurrent job), and finally clamped to 1–5.
func heavyJobLimit() int {
	limit := runtime.NumCPU() / 2
	if limit < 1 {
		limit = 1
	}
	if vm, err := mem.VirtualMemory(); err == nil && vm.Total > 0 {
		byMem := int(vm.Total / (2 << 30)) // ~2 GB per concurrent job
		if byMem < 1 {
			byMem = 1
		}
		if byMem < limit {
			limit = byMem
		}
	}
	if limit > 5 {
		limit = 5
	}
	return limit
}

func heavySemaphore() chan struct{} {
	heavyOnce.Do(func() { heavySem = make(chan struct{}, heavyJobLimit()) })
	return heavySem
}

// runHeavyJob blocks until a heavy-job slot is free (or ctx is cancelled), runs
// fn, then frees the slot. The wait honours ctx, so a request that times out or
// whose client disconnected won't sit in the queue forever. fn must not itself
// call runHeavyJob (no nested heavy jobs), or it could deadlock the pool.
func runHeavyJob(ctx context.Context, fn func() error) error {
	sem := heavySemaphore()
	select {
	case sem <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-sem }()
	return fn()
}

// combinedOutputGated runs cmd.CombinedOutput() through the heavy-job pool,
// returning the captured output and error just like the bare call would.
func combinedOutputGated(ctx context.Context, cmd *exec.Cmd) ([]byte, error) {
	var out []byte
	err := runHeavyJob(ctx, func() error {
		var runErr error
		out, runErr = cmd.CombinedOutput()
		return runErr
	})
	return out, err
}
