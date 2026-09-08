package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// appVersion is stamped at build time (-X main.appVersion=v1.2.3). Builds made
// straight from source keep "dev" and never offer to update themselves: there
// is no release to compare against, and replacing a hand-built tree would throw
// away whatever the developer just compiled.
var appVersion = "dev"

const (
	updateRepo         = "M1XaM/kit"
	checksumsAssetName = "checksums.txt"

	// Response caps. The release JSON and the checksums list are small; the
	// package itself is ~100-200MB today, so 3GB leaves room to grow while
	// still refusing an endless stream.
	maxReleaseJSONBytes int64 = 1 << 20
	maxChecksumsBytes   int64 = 1 << 16
	maxAssetBytes       int64 = 3 << 30

	// Unpacked-tree caps, so a malformed (or hostile) archive can't fill the
	// disk or spray thousands of files into the install folder.
	maxExtractBytes int64 = 6 << 30
	maxExtractFiles       = 4096

	// Files the running instance can't overwrite in place are parked under this
	// suffix and swept on the next start.
	oldSuffix = ".kit-old"
	// Scratch folder for the download and the unpacked tree. It sits inside the
	// install folder so the final move is a same-filesystem rename.
	stagingDirName = ".kit-update"

	// Handed to the freshly installed binary so it waits for this process to
	// release the port instead of mistaking it for a live instance.
	restartWaitEnv = "KIT_RESTART_WAIT_PORT"

	// GitHub allows 60 unauthenticated API calls per hour per IP. The UI polls
	// our local status endpoint every 30s, but the upstream call behind it is
	// throttled to this interval so a long-running Kit never gets rate-limited
	// (and never burns the user's quota for other GitHub work).
	defaultCheckInterval = 30 * time.Minute
	minCheckInterval     = 30 * time.Second
	checkIntervalEnv     = "KIT_UPDATE_CHECK_INTERVAL"
)

// Stages reported to the UI while an install runs.
const (
	stageIdle        = "idle"
	stageDownloading = "downloading"
	stageVerifying   = "verifying"
	stageInstalling  = "installing"
	stageRestarting  = "restarting"
	stageError       = "error"
)

var errUpdateBusy = errors.New("an update is already in progress")

// Where releases come from. Variables rather than constants only so the tests
// can point them at a local server; nothing at runtime rewrites them, and every
// download is still checked against updateAssetPrefix before it is fetched.
var (
	updateLatestAPI   = "https://api.github.com/repos/" + updateRepo + "/releases/latest"
	updateAssetPrefix = "https://github.com/" + updateRepo + "/releases/download/"
)

// releaseTarget is the immutable snapshot of what we're about to install, taken
// under the lock so a background check can't swap it mid-download.
type releaseTarget struct {
	version    string
	assetName  string
	assetURL   string
	assetSize  int64
	assetSHA   string // from the API's digest field, when it reports one
	checksums  string // URL of checksums.txt, when the release ships one
	releaseURL string
}

type updater struct {
	mu sync.Mutex

	port       string
	exeName    string
	installDir string
	assetName  string

	// supported is fixed at startup: an unversioned build, an unreleased
	// platform or a read-only install folder rules updating out entirely.
	supported bool
	reason    string

	latest     releaseTarget
	lastCheck  time.Time
	checkError string

	stage    string
	progress float64
	errMsg   string
	busy     bool

	// stopServer closes the HTTP listeners. An update calls it before starting
	// the new binary so the port is genuinely free by the time that binary
	// probes it.
	stopServer func()
}

// newUpdater decides once whether this instance is able to update itself.
func newUpdater(port string) *updater {
	u := &updater{port: port, stage: stageIdle}

	assetName, ok := platformAssetName()
	if !ok {
		u.reason = fmt.Sprintf("No published build for this platform (%s/%s).", runtime.GOOS, runtime.GOARCH)
		return u
	}
	u.assetName = assetName
	u.exeName = canonicalExeName()

	exe, err := os.Executable()
	if err != nil {
		u.reason = "Could not locate Kit's own executable."
		return u
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	u.installDir = filepath.Dir(exe)

	if !isVersioned(appVersion) {
		u.reason = "This build isn't versioned (built from source), so auto-update is off."
		return u
	}
	if err := checkWritable(u.installDir); err != nil {
		u.reason = "Kit's folder isn't writable, so it can't replace itself."
		return u
	}

	u.supported = true
	return u
}

// setStopper hands the updater the means to release the port at restart time.
func (u *updater) setStopper(stop func()) {
	u.mu.Lock()
	u.stopServer = stop
	u.mu.Unlock()
}

// run checks on start and then on a fixed interval for as long as Kit lives.
func (u *updater) run() {
	if !u.supported {
		return
	}
	u.check()

	ticker := time.NewTicker(checkInterval())
	defer ticker.Stop()
	for range ticker.C {
		u.check()
	}
}

func checkInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv(checkIntervalEnv))
	if raw == "" {
		return defaultCheckInterval
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < minCheckInterval {
		return defaultCheckInterval
	}
	return d
}

// check asks GitHub for the newest release and records what it found. Failures
// are kept as a note on the status rather than surfaced as errors: a machine
// that's offline should show nothing at all, not a scary banner.
func (u *updater) check() {
	u.mu.Lock()
	busy := u.busy
	u.mu.Unlock()
	if busy {
		return
	}

	target, err := fetchLatestRelease(u.assetName)

	u.mu.Lock()
	defer u.mu.Unlock()
	u.lastCheck = time.Now()
	if err != nil {
		u.checkError = err.Error()
		return
	}
	u.checkError = ""
	u.latest = target
}

func fetchLatestRelease(assetName string) (releaseTarget, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, updateLatestAPI, nil)
	if err != nil {
		return releaseTarget{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "kit-updater/"+appVersion)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return releaseTarget{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return releaseTarget{}, fmt.Errorf("GitHub returned %s", resp.Status)
	}

	var release struct {
		TagName    string `json:"tag_name"`
		HTMLURL    string `json:"html_url"`
		Draft      bool   `json:"draft"`
		Prerelease bool   `json:"prerelease"`
		Assets     []struct {
			Name   string `json:"name"`
			URL    string `json:"browser_download_url"`
			Size   int64  `json:"size"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxReleaseJSONBytes)).Decode(&release); err != nil {
		return releaseTarget{}, fmt.Errorf("could not read the release info: %w", err)
	}
	if release.Draft || release.Prerelease || !isVersioned(release.TagName) {
		return releaseTarget{}, nil
	}

	target := releaseTarget{
		version:    release.TagName,
		assetName:  assetName,
		releaseURL: release.HTMLURL,
	}
	for _, asset := range release.Assets {
		if !isTrustedAssetURL(asset.URL) {
			continue
		}
		switch asset.Name {
		case assetName:
			target.assetURL = asset.URL
			target.assetSize = asset.Size
			target.assetSHA = strings.TrimPrefix(strings.ToLower(asset.Digest), "sha256:")
		case checksumsAssetName:
			target.checksums = asset.URL
		}
	}
	if target.assetURL == "" {
		// A release without a package for this platform isn't an error worth
		// showing; it simply isn't installable from here.
		return releaseTarget{}, nil
	}
	return target, nil
}

// isTrustedAssetURL pins downloads to this repository's own release assets, so
// a tampered API response can't point the installer at somebody else's file.
func isTrustedAssetURL(raw string) bool {
	return strings.HasPrefix(raw, updateAssetPrefix) && !strings.Contains(raw, "..")
}

type updateStatus struct {
	CurrentVersion string  `json:"currentVersion"`
	LatestVersion  string  `json:"latestVersion"`
	Available      bool    `json:"available"`
	Supported      bool    `json:"supported"`
	Reason         string  `json:"reason,omitempty"`
	Stage          string  `json:"stage"`
	Progress       float64 `json:"progress"`
	Error          string  `json:"error,omitempty"`
	ReleaseURL     string  `json:"releaseUrl,omitempty"`
	CheckedAt      string  `json:"checkedAt,omitempty"`
	CheckError     string  `json:"checkError,omitempty"`
}

func (u *updater) status() updateStatus {
	u.mu.Lock()
	defer u.mu.Unlock()

	st := updateStatus{
		CurrentVersion: appVersion,
		LatestVersion:  u.latest.version,
		Available:      u.updateAvailableLocked(),
		Supported:      u.supported,
		Reason:         u.reason,
		Stage:          u.stage,
		Progress:       u.progress,
		Error:          u.errMsg,
		ReleaseURL:     u.latest.releaseURL,
		CheckError:     u.checkError,
	}
	if !u.lastCheck.IsZero() {
		st.CheckedAt = u.lastCheck.UTC().Format(time.RFC3339)
	}
	return st
}

func (u *updater) updateAvailableLocked() bool {
	return u.supported && u.latest.assetURL != "" && compareVersions(u.latest.version, appVersion) > 0
}

// startInstall kicks off the download in the background and returns as soon as
// it's running, so the browser isn't holding a request open for minutes.
func (u *updater) startInstall() error {
	u.mu.Lock()
	defer u.mu.Unlock()

	if !u.supported {
		return errors.New(u.reason)
	}
	if u.busy {
		return errUpdateBusy
	}
	if !u.updateAvailableLocked() {
		return errors.New("no update is available")
	}

	target := u.latest
	u.busy = true
	u.stage = stageDownloading
	u.progress = 0
	u.errMsg = ""

	go u.install(target)
	return nil
}

func (u *updater) setStage(stage string) {
	u.mu.Lock()
	u.stage = stage
	u.mu.Unlock()
}

func (u *updater) setProgress(fraction float64) {
	if fraction < 0 {
		fraction = 0
	} else if fraction > 1 {
		fraction = 1
	}
	u.mu.Lock()
	u.progress = fraction
	u.mu.Unlock()
}

// fail records why an update stopped and hands the reason back so the caller
// can bail out in one line.
func (u *updater) fail(msg string, err error) error {
	log.Printf("Update failed: %s: %v", msg, err)
	u.mu.Lock()
	u.busy = false
	u.stage = stageError
	u.errMsg = msg
	u.mu.Unlock()
	return fmt.Errorf("%s: %w", msg, err)
}

// install runs the update and, if it lands, restarts into it.
func (u *updater) install(target releaseTarget) {
	if err := u.stageAndApply(target); err != nil {
		return // stageAndApply has already recorded why.
	}

	u.setStage(stageRestarting)
	// Let the page see the restarting stage before its connection goes away.
	time.Sleep(1200 * time.Millisecond)

	// Free the port *before* launching the new binary. Kit's startup probe
	// treats a busy port as "another instance is already running" and bows out,
	// so a new build started while we still hold the socket would exit on the
	// spot rather than take over.
	u.mu.Lock()
	stop := u.stopServer
	u.mu.Unlock()
	if stop != nil {
		stop()
	}
	waitForPortRelease(u.port, 10*time.Second)

	if err := u.relaunch(); err != nil {
		u.fail("The update installed, but Kit couldn't restart itself — please start it again", err)
		return
	}

	log.Printf("Updated to %s. Restarting.", target.version)
	os.Exit(0)
}

// stageAndApply downloads, verifies and unpacks the release, then swaps it over
// the installed one. Nothing in the install folder is touched until the
// download has been checksum-verified and unpacked successfully.
func (u *updater) stageAndApply(target releaseTarget) error {
	staging := filepath.Join(u.installDir, stagingDirName)
	os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return u.fail("Could not create a staging folder next to Kit", err)
	}
	cleanup := func() { os.RemoveAll(staging) }

	archivePath := filepath.Join(staging, target.assetName)
	sum, err := u.download(target, archivePath)
	if err != nil {
		cleanup()
		return u.fail("Download failed", err)
	}

	u.setStage(stageVerifying)
	expected, err := expectedChecksum(target)
	if err != nil {
		cleanup()
		return u.fail("Could not confirm the download is genuine", err)
	}
	if !strings.EqualFold(expected, sum) {
		cleanup()
		return u.fail("The download didn't match its published checksum, so it was discarded", fmt.Errorf("want %s, got %s", expected, sum))
	}

	u.setStage(stageInstalling)
	tree := filepath.Join(staging, "tree")
	if err := extractArchive(archivePath, tree); err != nil {
		cleanup()
		return u.fail("Could not unpack the update", err)
	}
	if _, err := os.Stat(filepath.Join(tree, u.exeName)); err != nil {
		cleanup()
		return u.fail("The update package didn't contain Kit", err)
	}
	os.Remove(archivePath)

	if err := u.applyTree(tree); err != nil {
		return u.fail("Could not replace the installed files", err)
	}
	cleanup()
	return nil
}

// download streams the asset to disk, hashing as it goes, and returns the
// SHA-256 of what actually landed.
func (u *updater) download(target releaseTarget, dest string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.assetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "kit-updater/"+appVersion)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub returned %s", resp.Status)
	}

	total := target.assetSize
	if resp.ContentLength > 0 {
		total = resp.ContentLength
	}

	file, err := os.Create(dest)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hasher := sha256.New()
	counter := &progressCounter{updater: u, total: total}
	written, err := io.Copy(io.MultiWriter(file, hasher, counter), io.LimitReader(resp.Body, maxAssetBytes+1))
	if err != nil {
		return "", err
	}
	if written > maxAssetBytes {
		return "", fmt.Errorf("the release package is larger than %d bytes", maxAssetBytes)
	}
	if err := file.Sync(); err != nil {
		return "", err
	}
	u.setProgress(1)
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

type progressCounter struct {
	updater *updater
	total   int64
	done    int64
}

func (c *progressCounter) Write(p []byte) (int, error) {
	c.done += int64(len(p))
	if c.total > 0 {
		c.updater.setProgress(float64(c.done) / float64(c.total))
	}
	return len(p), nil
}

// expectedChecksum prefers the release's checksums.txt (which the release
// workflow generates from the very files it uploads) and falls back to the
// digest the GitHub API reports for the asset. With neither, the install is
// refused rather than run unverified.
func expectedChecksum(target releaseTarget) (string, error) {
	if target.checksums != "" {
		sum, err := fetchChecksum(target.checksums, target.assetName)
		if err == nil {
			return sum, nil
		}
		if target.assetSHA == "" {
			return "", err
		}
	}
	if target.assetSHA != "" {
		return target.assetSHA, nil
	}
	return "", errors.New("this release publishes no checksum for the package")
}

func fetchChecksum(url, assetName string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "kit-updater/"+appVersion)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("checksums.txt returned %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxChecksumsBytes))
	if err != nil {
		return "", err
	}
	return parseChecksums(string(body), assetName)
}

// parseChecksums reads sha256sum output ("<hex>  <name>", optionally with the
// binary-mode "*" marker) and returns the digest for one file.
func parseChecksums(body, assetName string) (string, error) {
	for _, line := range strings.Split(body, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) != 2 {
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		if path.Base(name) != assetName {
			continue
		}
		sum := strings.ToLower(fields[0])
		if len(sum) != 64 {
			return "", fmt.Errorf("checksum for %s is malformed", assetName)
		}
		if _, err := hex.DecodeString(sum); err != nil {
			return "", fmt.Errorf("checksum for %s is malformed", assetName)
		}
		return sum, nil
	}
	return "", fmt.Errorf("checksums.txt has no entry for %s", assetName)
}

// applyTree moves the unpacked files over the installed ones. Everything the
// archive doesn't mention is left alone, so data/ (notes, recordings, models)
// survives an update untouched.
func (u *updater) applyTree(tree string) error {
	var files []string
	err := filepath.WalkDir(tree, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(tree, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(u.installDir, rel), 0o755)
		}
		files = append(files, rel)
		return nil
	})
	if err != nil {
		return err
	}

	// Swap the launcher last: if anything fails part-way through, the binary
	// still on disk is the old one, so the version it reports stays honest and
	// the next launch can retry.
	sort.SliceStable(files, func(i, j int) bool {
		return files[j] == u.exeName && files[i] != u.exeName
	})

	for _, rel := range files {
		if err := replacePath(filepath.Join(tree, rel), filepath.Join(u.installDir, rel)); err != nil {
			return fmt.Errorf("%s: %w", rel, err)
		}
	}
	return nil
}

// replacePath moves src onto dst. A file that can't be overwritten in place —
// on Windows that includes the very binary running this code — is renamed out
// of the way first; the leftovers are swept on the next start.
func replacePath(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	parked := dst + oldSuffix
	os.Remove(parked)
	if err := os.Rename(dst, parked); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return os.Rename(src, dst)
}

// sweepParkedFiles deletes the .kit-old leftovers of a previous update, plus a
// staging folder abandoned by an install that died mid-flight. data/ is skipped
// so a user's own files are never in scope.
func sweepParkedFiles(installDir string) {
	os.RemoveAll(filepath.Join(installDir, stagingDirName))
	filepath.WalkDir(installDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != installDir && d.Name() == "data" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(d.Name(), oldSuffix) {
			os.Remove(p)
		}
		return nil
	})
}

// relaunch starts the freshly installed binary. It's told which port this
// process is about to release so it waits instead of concluding that another
// instance is already serving.
func (u *updater) relaunch() error {
	cmd := hiddenCommand(filepath.Join(u.installDir, u.exeName))
	cmd.Dir = u.installDir
	cmd.Env = append(os.Environ(), restartWaitEnv+"="+u.port)
	return cmd.Start()
}

// waitForPortRelease blocks until the given port is free. Both sides of a
// restart use it: the outgoing process to confirm it really let go, and the
// incoming one to wait its turn.
func waitForPortRelease(port string, timeout time.Duration) {
	if port == "" {
		return
	}
	if _, err := strconv.Atoi(port); err != nil {
		return
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !isPortInUse(port) {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func extractArchive(archivePath, dest string) error {
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	switch {
	case strings.HasSuffix(archivePath, ".tar.gz"):
		return extractUpdateTarGz(archivePath, dest)
	case strings.HasSuffix(archivePath, ".zip"):
		return extractUpdateZip(archivePath, dest)
	}
	return fmt.Errorf("unsupported package format: %s", filepath.Base(archivePath))
}

func extractUpdateTarGz(archivePath, dest string) error {
	file, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer file.Close()

	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()

	reader := tar.NewReader(gz)
	budget := &extractBudget{}
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		target, err := safeUpdatePath(dest, header.Name)
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := budget.addFile(); err != nil {
				return err
			}
			if err := writeExtractedFile(target, reader, fs.FileMode(header.Mode).Perm(), budget); err != nil {
				return err
			}
		case tar.TypeSymlink:
			// The bundled ONNX Runtime ships as libonnxruntime.so -> the
			// versioned file, so links have to survive the round trip — but
			// only ones that stay inside the unpacked tree.
			if err := writeExtractedSymlink(dest, target, header.Linkname); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unexpected entry %q in the update package", header.Name)
		}
	}
}

func extractUpdateZip(archivePath, dest string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer reader.Close()

	budget := &extractBudget{}
	for _, entry := range reader.File {
		target, err := safeUpdatePath(dest, entry.Name)
		if err != nil {
			return err
		}
		info := entry.FileInfo()
		if info.IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("unexpected entry %q in the update package", entry.Name)
		}
		if err := budget.addFile(); err != nil {
			return err
		}
		src, err := entry.Open()
		if err != nil {
			return err
		}
		err = writeExtractedFile(target, src, info.Mode().Perm(), budget)
		src.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

type extractBudget struct {
	files int
	bytes int64
}

func (b *extractBudget) addFile() error {
	b.files++
	if b.files > maxExtractFiles {
		return fmt.Errorf("the update package contains more than %d files", maxExtractFiles)
	}
	return nil
}

func (b *extractBudget) copy(dst io.Writer, src io.Reader) error {
	remaining := maxExtractBytes - b.bytes
	written, err := io.Copy(dst, io.LimitReader(src, remaining+1))
	b.bytes += written
	if err != nil {
		return err
	}
	if written > remaining {
		return fmt.Errorf("the update package unpacks to more than %d bytes", maxExtractBytes)
	}
	return nil
}

func writeExtractedFile(target string, src io.Reader, mode fs.FileMode, budget *extractBudget) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	if mode == 0 {
		mode = 0o644
	}
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer out.Close()
	if err := budget.copy(out, src); err != nil {
		return err
	}
	// The archive's permission bits are advisory on some filesystems; set them
	// explicitly so the binaries and the sidecars stay executable.
	return os.Chmod(target, mode)
}

func writeExtractedSymlink(root, target, linkname string) error {
	if filepath.IsAbs(linkname) || strings.HasPrefix(linkname, "/") {
		return fmt.Errorf("the update package contains an absolute symlink")
	}
	resolved := filepath.Clean(filepath.Join(filepath.Dir(target), filepath.FromSlash(linkname)))
	if !withinDir(root, resolved) {
		return fmt.Errorf("the update package contains a symlink pointing outside it")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	os.Remove(target)
	return os.Symlink(filepath.FromSlash(linkname), target)
}

// safeUpdatePath keeps every extracted entry inside the staging tree, so a
// crafted "../../" name can't write anywhere else on disk.
func safeUpdatePath(root, name string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(name))
	// An absolute entry is rejected outright rather than re-rooted: a package
	// built by our own release workflow never contains one, so seeing it means
	// the archive isn't what we expect. (IsAbs is false for a bare leading
	// separator on Windows, hence the second check.)
	if cleaned == "." || cleaned == "" || filepath.IsAbs(cleaned) ||
		strings.HasPrefix(cleaned, string(filepath.Separator)) ||
		strings.HasPrefix(cleaned, "..") {
		return "", fmt.Errorf("invalid path %q in the update package", name)
	}
	target := filepath.Join(root, cleaned)
	if !withinDir(root, target) {
		return "", fmt.Errorf("invalid path %q in the update package", name)
	}
	return target, nil
}

func withinDir(root, target string) bool {
	if target == root {
		return true
	}
	return strings.HasPrefix(target, root+string(filepath.Separator))
}

func platformAssetName() (string, bool) {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "linux/amd64":
		return "kit-linux-amd64.tar.gz", true
	case "windows/amd64":
		return "kit-windows-amd64.zip", true
	case "darwin/arm64":
		return "kit-macos-arm64.tar.gz", true
	}
	return "", false
}

func canonicalExeName() string {
	if runtime.GOOS == "windows" {
		return "install-kit.exe"
	}
	return "install-kit"
}

func checkWritable(dir string) error {
	probe, err := os.CreateTemp(dir, ".kit-write-probe-*")
	if err != nil {
		return err
	}
	name := probe.Name()
	probe.Close()
	return os.Remove(name)
}

// isVersioned reports whether a string looks like a release tag ("v1.2.3"), as
// opposed to the "dev" placeholder of a source build.
func isVersioned(v string) bool {
	v = strings.TrimSpace(v)
	if !strings.HasPrefix(v, "v") {
		return false
	}
	head, _, _ := strings.Cut(strings.TrimPrefix(v, "v"), "-")
	parts := strings.Split(head, ".")
	if len(parts) == 0 || parts[0] == "" {
		return false
	}
	for _, part := range parts {
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

// compareVersions orders two release tags: negative if a < b, zero if equal,
// positive if a > b. Missing components count as zero (v1.2 == v1.2.0) and a
// pre-release suffix sorts below the plain release (v1.2.0-rc1 < v1.2.0).
func compareVersions(a, b string) int {
	aNums, aPre := splitVersion(a)
	bNums, bPre := splitVersion(b)

	for i := 0; i < len(aNums) || i < len(bNums); i++ {
		x, y := 0, 0
		if i < len(aNums) {
			x = aNums[i]
		}
		if i < len(bNums) {
			y = bNums[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}

	switch {
	case aPre == bPre:
		return 0
	case aPre == "":
		return 1
	case bPre == "":
		return -1
	case aPre < bPre:
		return -1
	}
	return 1
}

func splitVersion(v string) ([]int, string) {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	head, pre, _ := strings.Cut(v, "-")
	var nums []int
	for _, part := range strings.Split(head, ".") {
		n, err := strconv.Atoi(part)
		if err != nil {
			break
		}
		nums = append(nums, n)
	}
	return nums, pre
}

func (u *updater) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(u.status())
}

func (u *updater) handleInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := u.startInstall(); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, errUpdateBusy) {
			status = http.StatusConflict
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"status":"started"}`))
}

// isBusy reports whether an update is downloading or installing right now.
func (u *updater) isBusy() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.busy
}

// waitUntilIdle blocks while an install is in flight, so the process doesn't
// exit half-way through replacing itself. A successful install never returns
// from here — it relaunches and exits — so this only covers the failure paths.
func (u *updater) waitUntilIdle(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for u.isBusy() && time.Now().Before(deadline) {
		time.Sleep(250 * time.Millisecond)
	}
}
