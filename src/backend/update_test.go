package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v1.2.3", "v1.2.3", 0},
		{"v1.2", "v1.2.0", 0},
		{"v1.2.4", "v1.2.3", 1},
		{"v1.3.0", "v1.2.9", 1},
		{"v2.0.0", "v10.0.0", -1},
		{"v1.10.0", "v1.9.0", 1},
		{"v1.2.0-rc1", "v1.2.0", -1},
		{"v1.2.0", "v1.2.0-rc1", 1},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

// A source build reports "dev" and must never try to replace itself with a
// release package.
func TestIsVersioned(t *testing.T) {
	for _, v := range []string{"v1.0.0", "v0.1", "v1.2.3-rc1"} {
		if !isVersioned(v) {
			t.Errorf("isVersioned(%q) = false, want true", v)
		}
	}
	for _, v := range []string{"dev", "", "1.2.3", "vNext", "v"} {
		if isVersioned(v) {
			t.Errorf("isVersioned(%q) = true, want false", v)
		}
	}
}

func TestParseChecksums(t *testing.T) {
	sum := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	body := "aaaa  kit-macos-arm64.tar.gz\n" + sum + " *kit-linux-amd64.tar.gz\n"
	got, err := parseChecksums(body, "kit-linux-amd64.tar.gz")
	if err != nil {
		t.Fatalf("parseChecksums returned %v", err)
	}
	if got != sum {
		t.Errorf("parseChecksums = %q, want %q", got, sum)
	}
	if _, err := parseChecksums(body, "kit-windows-amd64.zip"); err == nil {
		t.Error("parseChecksums accepted a name the file doesn't list")
	}
	// A truncated digest must be rejected rather than silently compared.
	if _, err := parseChecksums("dead  kit-linux-amd64.tar.gz\n", "kit-linux-amd64.tar.gz"); err == nil {
		t.Error("parseChecksums accepted a malformed digest")
	}
}

// Only this repository's own release assets may be downloaded, so a tampered
// API response can't redirect the installer somewhere else.
func TestIsTrustedAssetURL(t *testing.T) {
	if !isTrustedAssetURL("https://github.com/M1XaM/kit/releases/download/v1.0.0/kit-linux-amd64.tar.gz") {
		t.Error("a genuine release asset URL was rejected")
	}
	for _, raw := range []string{
		"http://github.com/M1XaM/kit/releases/download/v1.0.0/kit-linux-amd64.tar.gz",
		"https://github.com/someone/else/releases/download/v1.0.0/kit-linux-amd64.tar.gz",
		"https://evil.example/M1XaM/kit/releases/download/v1.0.0/kit.tar.gz",
		"https://github.com/M1XaM/kit/releases/download/../../evil",
	} {
		if isTrustedAssetURL(raw) {
			t.Errorf("isTrustedAssetURL(%q) = true, want false", raw)
		}
	}
}

func TestSafeUpdatePathRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"../evil", "/etc/passwd", "lib/../../evil", "..", "."} {
		if _, err := safeUpdatePath(root, name); err == nil {
			t.Errorf("safeUpdatePath accepted %q", name)
		}
	}
	got, err := safeUpdatePath(root, "lib/kit-bgremove")
	if err != nil {
		t.Fatalf("safeUpdatePath rejected a normal entry: %v", err)
	}
	if got != filepath.Join(root, "lib", "kit-bgremove") {
		t.Errorf("safeUpdatePath = %q", got)
	}
}

func writeTarGz(t *testing.T, entries []*tar.Header, bodies []string) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for i, header := range entries {
		if header.Typeflag == tar.TypeReg {
			header.Size = int64(len(bodies[i]))
		}
		if err := tw.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Typeflag == tar.TypeReg {
			if _, err := tw.Write([]byte(bodies[i])); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "kit-linux-amd64.tar.gz")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestExtractArchiveTarGz(t *testing.T) {
	archive := writeTarGz(t,
		[]*tar.Header{
			{Name: "install-kit", Mode: 0o755, Typeflag: tar.TypeReg},
			{Name: "lib", Mode: 0o755, Typeflag: tar.TypeDir},
			{Name: "lib/libonnxruntime.so.1.20.0", Mode: 0o644, Typeflag: tar.TypeReg},
			{Name: "lib/libonnxruntime.so", Typeflag: tar.TypeSymlink, Linkname: "libonnxruntime.so.1.20.0"},
		},
		[]string{"binary", "", "lib", ""},
	)

	dest := filepath.Join(t.TempDir(), "tree")
	if err := extractArchive(archive, dest); err != nil {
		t.Fatalf("extractArchive returned %v", err)
	}

	info, err := os.Stat(filepath.Join(dest, "install-kit"))
	if err != nil {
		t.Fatalf("install-kit was not extracted: %v", err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Error("install-kit lost its executable bit, so the update wouldn't launch")
	}
	// The bundled ONNX Runtime relies on libonnxruntime.so pointing at the
	// versioned file; a flattened copy would break the AI sidecars.
	link, err := os.Readlink(filepath.Join(dest, "lib", "libonnxruntime.so"))
	if err != nil {
		t.Fatalf("the symlink was not preserved: %v", err)
	}
	if link != "libonnxruntime.so.1.20.0" {
		t.Errorf("symlink points at %q", link)
	}
}

func TestExtractArchiveRejectsEscapingEntries(t *testing.T) {
	traversal := writeTarGz(t,
		[]*tar.Header{{Name: "../pwned", Mode: 0o644, Typeflag: tar.TypeReg}},
		[]string{"nope"},
	)
	if err := extractArchive(traversal, filepath.Join(t.TempDir(), "tree")); err == nil {
		t.Error("extractArchive accepted an entry that escapes the staging folder")
	}

	escapingLink := writeTarGz(t,
		[]*tar.Header{{Name: "link", Typeflag: tar.TypeSymlink, Linkname: "../../etc/passwd"}},
		[]string{""},
	)
	if err := extractArchive(escapingLink, filepath.Join(t.TempDir(), "tree")); err == nil {
		t.Error("extractArchive accepted a symlink pointing outside the staging folder")
	}
}

// The archive only carries program files, so notes, recordings and downloaded
// models under data/ must come through an update untouched.
func TestApplyTreeReplacesFilesAndKeepsUserData(t *testing.T) {
	installDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(installDir, "install-kit"), []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(installDir, "data", "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	note := filepath.Join(installDir, "data", "notes", "keep.md")
	if err := os.WriteFile(note, []byte("my note"), 0o644); err != nil {
		t.Fatal(err)
	}

	tree := filepath.Join(installDir, stagingDirName, "tree")
	if err := os.MkdirAll(filepath.Join(tree, "lib"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "install-kit"), []byte("new"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tree, "lib", "yt-dlp"), []byte("yt"), 0o755); err != nil {
		t.Fatal(err)
	}

	u := &updater{installDir: installDir, exeName: "install-kit"}
	if err := u.applyTree(tree); err != nil {
		t.Fatalf("applyTree returned %v", err)
	}

	if got, _ := os.ReadFile(filepath.Join(installDir, "install-kit")); string(got) != "new" {
		t.Errorf("install-kit was not replaced, got %q", got)
	}
	if got, _ := os.ReadFile(filepath.Join(installDir, "lib", "yt-dlp")); string(got) != "yt" {
		t.Errorf("lib/yt-dlp was not installed, got %q", got)
	}
	if got, err := os.ReadFile(note); err != nil || string(got) != "my note" {
		t.Errorf("the user's note under data/ did not survive the update: %q, %v", got, err)
	}
}

func TestSweepParkedFilesLeavesUserDataAlone(t *testing.T) {
	installDir := t.TempDir()
	parked := filepath.Join(installDir, "install-kit"+oldSuffix)
	if err := os.WriteFile(parked, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(installDir, stagingDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(installDir, "data"), 0o755); err != nil {
		t.Fatal(err)
	}
	// A user file that merely shares the suffix must not be swept away.
	userFile := filepath.Join(installDir, "data", "backup"+oldSuffix)
	if err := os.WriteFile(userFile, []byte("mine"), 0o644); err != nil {
		t.Fatal(err)
	}

	sweepParkedFiles(installDir)

	if _, err := os.Stat(parked); !os.IsNotExist(err) {
		t.Error("the parked binary from a previous update was not removed")
	}
	if _, err := os.Stat(filepath.Join(installDir, stagingDirName)); !os.IsNotExist(err) {
		t.Error("the abandoned staging folder was not removed")
	}
	if _, err := os.Stat(userFile); err != nil {
		t.Errorf("a file under data/ was swept: %v", err)
	}
}

func TestUpdateAvailableRequiresNewerVersionAndAsset(t *testing.T) {
	u := &updater{supported: true, latest: releaseTarget{
		version:  appVersion,
		assetURL: "https://github.com/M1XaM/kit/releases/download/v9.9.9/kit-linux-amd64.tar.gz",
	}}
	if u.updateAvailableLocked() {
		t.Error("an update was offered for the version already running")
	}

	u.latest.version = "v999.0.0"
	if !u.updateAvailableLocked() {
		t.Error("a newer release was not offered")
	}

	u.latest.assetURL = ""
	if u.updateAvailableLocked() {
		t.Error("an update was offered even though the release has no package for this platform")
	}

	u.latest.assetURL = "https://github.com/M1XaM/kit/releases/download/v999.0.0/kit-linux-amd64.tar.gz"
	u.supported = false
	if u.updateAvailableLocked() {
		t.Error("an update was offered on a build that can't install one")
	}
}

// fakeRelease stands in for GitHub: it serves a releases/latest payload plus
// the package and checksums.txt it points at.
type fakeRelease struct {
	server    *httptest.Server
	assetName string
	body      []byte
	checksum  string
	tag       string
}

func newFakeRelease(t *testing.T, tag string, files map[string]string) *fakeRelease {
	t.Helper()

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, content := range files {
		header := &tar.Header{Name: name, Mode: 0o755, Typeflag: tar.TypeReg, Size: int64(len(content))}
		if err := tw.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}

	rel := &fakeRelease{assetName: "kit-linux-amd64.tar.gz", body: buf.Bytes(), tag: tag}
	rel.checksum = fmt.Sprintf("%x", sha256.Sum256(rel.body))

	mux := http.NewServeMux()
	mux.HandleFunc("/latest", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{
			"tag_name": %q,
			"html_url": "https://example.invalid/release",
			"draft": false,
			"prerelease": false,
			"assets": [
				{"name": %q, "browser_download_url": %q, "size": %d},
				{"name": "checksums.txt", "browser_download_url": %q, "size": 100}
			]
		}`, rel.tag, rel.assetName, rel.server.URL+"/download/"+rel.assetName, len(rel.body),
			rel.server.URL+"/download/checksums.txt")
	})
	mux.HandleFunc("/download/"+rel.assetName, func(w http.ResponseWriter, r *http.Request) {
		w.Write(rel.body)
	})
	mux.HandleFunc("/download/checksums.txt", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "%s  %s\n", rel.checksum, rel.assetName)
	})

	rel.server = httptest.NewServer(mux)
	t.Cleanup(rel.server.Close)
	return rel
}

// point aims the updater at the fake release server for the duration of a test.
func (f *fakeRelease) point(t *testing.T) {
	t.Helper()
	origAPI, origPrefix := updateLatestAPI, updateAssetPrefix
	updateLatestAPI = f.server.URL + "/latest"
	updateAssetPrefix = f.server.URL + "/download/"
	t.Cleanup(func() {
		updateLatestAPI, updateAssetPrefix = origAPI, origPrefix
	})
}

func newTestUpdater(t *testing.T, installDir string) *updater {
	t.Helper()
	if err := os.WriteFile(filepath.Join(installDir, "install-kit"), []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	return &updater{
		port:       "8080",
		exeName:    "install-kit",
		assetName:  "kit-linux-amd64.tar.gz",
		installDir: installDir,
		supported:  true,
		stage:      stageIdle,
	}
}

// The whole path a user's click takes: see the release, fetch it, verify it
// against checksums.txt, unpack it and put it in place.
func TestCheckAndInstallEndToEnd(t *testing.T) {
	installDir := t.TempDir()
	release := newFakeRelease(t, "v999.0.0", map[string]string{
		"install-kit":   "new binary",
		"lib/yt-dlp":    "new yt-dlp",
		"uninstall-kit": "new uninstaller",
	})
	release.point(t)

	u := newTestUpdater(t, installDir)
	u.check()

	if u.checkError != "" {
		t.Fatalf("check reported %q", u.checkError)
	}
	if u.latest.version != "v999.0.0" {
		t.Fatalf("latest version = %q", u.latest.version)
	}
	if !u.updateAvailableLocked() {
		t.Fatal("a newer release was not reported as available")
	}
	if u.latest.checksums == "" {
		t.Error("checksums.txt was not picked up from the release")
	}

	if err := u.stageAndApply(u.latest); err != nil {
		t.Fatalf("stageAndApply returned %v", err)
	}

	for name, want := range map[string]string{
		"install-kit":   "new binary",
		"lib/yt-dlp":    "new yt-dlp",
		"uninstall-kit": "new uninstaller",
	} {
		got, err := os.ReadFile(filepath.Join(installDir, filepath.FromSlash(name)))
		if err != nil || string(got) != want {
			t.Errorf("%s = %q (%v), want %q", name, got, err, want)
		}
	}
	if _, err := os.Stat(filepath.Join(installDir, stagingDirName)); !os.IsNotExist(err) {
		t.Error("the staging folder was left behind after a successful install")
	}
}

// A package whose bytes don't match the published checksum must be thrown away
// with the installed copy untouched.
func TestInstallRejectsMismatchedChecksum(t *testing.T) {
	installDir := t.TempDir()
	release := newFakeRelease(t, "v999.0.0", map[string]string{"install-kit": "tampered binary"})
	release.checksum = "0000000000000000000000000000000000000000000000000000000000000000"
	release.point(t)

	u := newTestUpdater(t, installDir)
	u.check()
	if err := u.stageAndApply(u.latest); err == nil {
		t.Fatal("stageAndApply installed a package that failed its checksum")
	}

	got, err := os.ReadFile(filepath.Join(installDir, "install-kit"))
	if err != nil || string(got) != "old binary" {
		t.Errorf("the installed binary was modified: %q (%v)", got, err)
	}
	if u.stage != stageError || u.errMsg == "" {
		t.Errorf("the failure was not reported to the UI: stage=%q error=%q", u.stage, u.errMsg)
	}
	if _, err := os.Stat(filepath.Join(installDir, stagingDirName)); !os.IsNotExist(err) {
		t.Error("the rejected download was not cleaned up")
	}
}

// A release that points somewhere other than this repo's own release assets is
// ignored rather than downloaded.
func TestCheckIgnoresUntrustedAssetURL(t *testing.T) {
	release := newFakeRelease(t, "v999.0.0", map[string]string{"install-kit": "new binary"})
	release.point(t)
	// Leave the API where it is but pin downloads to the real GitHub prefix, so
	// the asset URLs the fake serves no longer qualify.
	updateAssetPrefix = "https://github.com/" + updateRepo + "/releases/download/"

	u := newTestUpdater(t, t.TempDir())
	u.check()

	if u.latest.assetURL != "" {
		t.Errorf("an asset from an untrusted host was accepted: %q", u.latest.assetURL)
	}
	if u.updateAvailableLocked() {
		t.Error("an update was offered with no trusted package behind it")
	}
}
