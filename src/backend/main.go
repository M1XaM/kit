package main

import (
	"fmt"
	"io"
	"local-tools-hub/backend/features"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

var withTerminal = "false"

func terminalEnabled() bool {
	return strings.EqualFold(withTerminal, "true")
}

func main() {
	showTerm := terminalEnabled()
	registerCustomScheme(showTerm)

	// Probe ports starting at the base. If a Kit instance is already running
	// on one, ask it to open a new browser tab instead of starting a second
	// instance. If a port is occupied by some other application, fall through
	// to the next one so Kit still starts.
	const basePort = 8080
	port := ""
	for candidate := basePort; candidate < basePort+10; candidate++ {
		p := strconv.Itoa(candidate)
		if !isPortInUse(p) {
			port = p
			break
		}
		if askRunningInstanceToOpenTab(p) {
			os.Exit(0)
		}
	}
	if port == "" {
		log.Fatalf("No free port found in range %d-%d", basePort, basePort+9)
	}

	// Sweep working files left over by a previous run that didn't exit cleanly.
	// Runs synchronously before the server accepts requests so it can't race a
	// handler creating a temp file. Safe because we're the sole instance (a
	// second launch already exited during the port probe above).
	features.CleanupTempRoot()

	// Erased notes live in data/notes/trash for 7 days; purge expired ones.
	go features.CleanupNotesTrash()

	url := fmt.Sprintf("http://localhost:%s", port)
	server := setupServer(port)

	// Bind to the loopback interfaces only: Kit's API gives access to local
	// files and tools, so it must never be reachable from other machines.
	ln4, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		log.Fatalf("Failed to listen on 127.0.0.1:%s: %v", port, err)
	}
	listeners := []net.Listener{ln4}
	if ln6, err := net.Listen("tcp", "[::1]:"+port); err == nil {
		listeners = append(listeners, ln6)
	}

	// Signal when the HTTP server exits (clean shutdown or fatal error).
	serverDone := make(chan struct{})
	go func() {
		fmt.Printf("Server listening on %s\n", url)
		errs := make(chan error, len(listeners))
		for _, ln := range listeners {
			go func(ln net.Listener) { errs <- server.Serve(ln) }(ln)
		}
		if err := <-errs; err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
		close(serverDone)
	}()

	go monitorConnections(server)

	go func() {
		if waitForServerReady(url, 5*time.Second) {
			openBrowserWithRetry(url, 3, 400*time.Millisecond)
			return
		}
		openBrowserWithRetry(url, 5, 700*time.Millisecond)
	}()

	// Block until the server shuts down (triggered by monitorConnections
	// when no WebSocket clients remain for 5 seconds).
	<-serverDone
	fmt.Println("Server shut down. Goodbye.")
}

// askRunningInstanceToOpenTab hits /api/open on a port that is already in use.
// It returns true only when the responder identifies as Kit, so a stranger's
// server occupying the port doesn't make us exit without doing anything.
func askRunningInstanceToOpenTab(port string) bool {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%s/api/open", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
	return resp.StatusCode == http.StatusOK && strings.TrimSpace(string(body)) == "ok"
}
