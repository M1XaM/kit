package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// TestSecurityHeadersAllowBlobMedia guards against regressing the CSP so that
// recorded clips and uploaded-file previews (blob: URLs) and the live
// camera/mic previews (mediastream:) keep playing in the in-browser players.
func TestSecurityHeadersAllowBlobMedia(t *testing.T) {
	p := &securityPolicy{}
	rec := httptest.NewRecorder()
	p.setSecurityHeaders(rec)

	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("Content-Security-Policy header is not set")
	}

	// Find the media-src directive and assert it permits blob: and mediastream:.
	var mediaSrc string
	for _, directive := range strings.Split(csp, ";") {
		directive = strings.TrimSpace(directive)
		if strings.HasPrefix(directive, "media-src") {
			mediaSrc = directive
			break
		}
	}
	if mediaSrc == "" {
		t.Fatalf("CSP has no media-src directive, so blob: media falls back to default-src and is blocked: %q", csp)
	}
	for _, want := range []string{"blob:", "mediastream:"} {
		if !strings.Contains(mediaSrc, want) {
			t.Errorf("media-src is missing %q: %q", want, mediaSrc)
		}
	}
}
