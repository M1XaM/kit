package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"strings"
)

// Large enough to accept video uploads for the local ffmpeg-backed tools.
// Everything runs on localhost against files the user already has on disk.
const maxRequestBodyBytes int64 = 2 << 30

type securityPolicy struct {
	sessionToken   string
	allowedOrigins map[string]struct{}
	allowedHosts   map[string]struct{}
	csp            string
}

func newSecurityPolicy(port string) *securityPolicy {
	allowedOrigins := map[string]struct{}{
		"http://localhost:" + port: {},
		"http://127.0.0.1:" + port: {},
		"http://[::1]:" + port:     {},
	}
	allowedHosts := map[string]struct{}{
		"localhost:" + port: {},
		"127.0.0.1:" + port: {},
		"[::1]:" + port:     {},
	}

	// Optional extension for local development UI hosts, comma-separated.
	for _, origin := range strings.Split(os.Getenv("KIT_ALLOWED_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		allowedOrigins[origin] = struct{}{}
	}

	// connect-src lists Kit's own websocket origins explicitly rather than a
	// blanket ws:, so page scripts can't open sockets to arbitrary hosts.
	// speed.cloudflare.com powers the Internet Speed test and keys.openpgp.org
	// the checksum tool's automatic GPG key lookup.
	// media-src must allow blob: so recorded clips and uploaded-file previews
	// play in the in-browser <video>/<audio> players (their URLs come from
	// URL.createObjectURL); mediastream: covers the live camera/mic previews
	// set via srcObject. Without this, default-src 'self' blocks them and only
	// the download links work.
	// script-src needs 'wasm-unsafe-eval': the OCR engine (tesseract.js) and
	// the MD5/CRC32 hashers (hash-wasm) compile WebAssembly at runtime; without
	// it WebAssembly.instantiate is blocked and those tools fail outright.
	wsOrigins := "ws://localhost:" + port + " ws://127.0.0.1:" + port + " ws://[::1]:" + port
	csp := "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
		"connect-src 'self' " + wsOrigins + " https://speed.cloudflare.com https://keys.openpgp.org; " +
		"img-src 'self' data: blob: https://speed.cloudflare.com; " +
		"media-src 'self' blob: mediastream:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'"

	return &securityPolicy{
		sessionToken:   mustNewSessionToken(),
		allowedOrigins: allowedOrigins,
		allowedHosts:   allowedHosts,
		csp:            csp,
	}
}

func mustNewSessionToken() string {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}

func (p *securityPolicy) wrapRootHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := p.allowedHosts[r.Host]; !ok {
			http.Error(w, "Invalid host", http.StatusForbidden)
			return
		}

		p.setSecurityHeaders(w)
		p.setSessionCookie(w, r)
		p.applyCORS(w, r)

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (p *securityPolicy) wrapAPIHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !p.isTrustedOrigin(r) || !p.hasValidSession(r) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
		}

		next(w, r)
	}
}

func (p *securityPolicy) wrapWebSocketHandler(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !p.isTrustedOrigin(r) || !p.hasValidSession(r) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

func (p *securityPolicy) hasValidSession(r *http.Request) bool {
	cookie, err := r.Cookie("kit_session")
	if err != nil {
		return false
	}

	if len(cookie.Value) != len(p.sessionToken) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(p.sessionToken)) == 1
}

func (p *securityPolicy) isTrustedOrigin(r *http.Request) bool {
	if origin := r.Header.Get("Origin"); origin != "" {
		if _, ok := p.allowedOrigins[origin]; !ok {
			return false
		}
	}

	if secFetchSite := r.Header.Get("Sec-Fetch-Site"); secFetchSite != "" &&
		secFetchSite != "same-origin" && secFetchSite != "none" {
		return false
	}

	if referer := r.Header.Get("Referer"); referer != "" {
		refURL, err := url.Parse(referer)
		if err != nil || refURL.Host != r.Host {
			return false
		}
	}

	return true
}

func (p *securityPolicy) applyCORS(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return
	}
	if _, ok := p.allowedOrigins[origin]; !ok {
		return
	}

	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func (p *securityPolicy) setSessionCookie(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("kit_session"); err == nil {
		if len(cookie.Value) == len(p.sessionToken) &&
			subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(p.sessionToken)) == 1 {
			return
		}
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "kit_session",
		Value:    p.sessionToken,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
}

func (p *securityPolicy) setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", p.csp)
}
