package features

import (
	"slices"
	"strings"
	"testing"
)

// joinedArgs is a helper to assert on the flattened yt-dlp argument list.
func argValue(args []string, flag string) (string, bool) {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1], true
		}
	}
	return "", false
}

// The "both" + "best"/≤1080 path must prefer H.264 + AAC and produce an MP4.
// This is the fix for the black-screen-with-sound bug: YouTube's raw "best"
// video is VP9/AV1, which muxed into MP4 plays as audio-only in many players.
func TestYtFormat_BothBestPrefersH264MP4(t *testing.T) {
	for _, q := range []string{"best", "", "1080", "720", "480", "360"} {
		args := ytQualityFormat("both", q)
		sort, ok := argValue(args, "-S")
		if !ok || !strings.HasPrefix(sort, "vcodec:h264") {
			t.Errorf("quality %q: expected H.264-first -S sort, got %v", q, args)
		}
		if merge, _ := argValue(args, "--merge-output-format"); merge != "mp4" {
			t.Errorf("quality %q: expected mp4 merge container, got %q", q, merge)
		}
	}
}

// The explicit high-res options (1440p/2160p) only exist as VP9/AV1, so they
// must sort by resolution (not force H.264, which would silently drop them to
// 1080p) and merge into MKV so the codecs actually play.
func TestYtFormat_HighResUsesResSortAndMKV(t *testing.T) {
	for _, q := range []string{"1440", "2160"} {
		args := ytQualityFormat("both", q)
		if sort, _ := argValue(args, "-S"); !strings.HasPrefix(sort, "res") {
			t.Errorf("quality %q: expected res-first -S sort, got %v", q, args)
		}
		if merge, _ := argValue(args, "--merge-output-format"); merge != "mkv" {
			t.Errorf("quality %q: expected mkv merge container, got %q", q, merge)
		}
	}
}

// Every "both"/"video" selection must carry a codec sort so we never fall back
// to yt-dlp's default (which picks VP9/AV1).
func TestYtFormat_VideoCarriesSort(t *testing.T) {
	args := ytQualityFormat("video", "1080")
	if !slices.Contains(args, "-S") {
		t.Errorf("video mode missing -S sort: %v", args)
	}
}
