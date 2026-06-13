package features

import (
	"os"
	"path/filepath"
	"sync"
)

// All of Kit's transient working files (uploads, ffmpeg/Ghostscript output, zip
// staging, …) live under one dedicated root inside the system temp dir instead
// of being scattered across it. That keeps cleanup trivial and safe:
// CleanupTempRoot wipes the whole root at startup, so files a previous run left
// behind — e.g. because it crashed before its deferred os.Remove ran — don't
// accumulate over time.

const tempRootName = "kit-work"

var (
	tempRootOnce sync.Once
	tempRootDir  string
)

// tempRoot returns the dedicated working directory, creating it on first use.
// Falls back to the plain system temp dir if the root can't be created.
func tempRoot() string {
	tempRootOnce.Do(func() {
		dir := filepath.Join(os.TempDir(), tempRootName)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			dir = os.TempDir()
		}
		tempRootDir = dir
	})
	return tempRootDir
}

// CleanupTempRoot removes leftover working files from earlier runs. Call it once
// at startup, before any handler creates temp files. It's safe to wipe the whole
// root because Kit runs as a single instance — a second launch exits during the
// port probe — so no other live process owns files under it.
func CleanupTempRoot() {
	dir := filepath.Join(os.TempDir(), tempRootName)
	os.RemoveAll(dir)
	os.MkdirAll(dir, 0o700)
}
