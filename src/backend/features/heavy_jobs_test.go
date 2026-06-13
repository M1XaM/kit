package features

import (
	"context"
	"errors"
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
