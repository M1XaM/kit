package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

func main() {
	showTerm := flag.Bool("term", true, "Show terminal with logs when launched via URL scheme")
	flag.Parse()

	registerCustomScheme(*showTerm)

	basePort := 8080
	port := strconv.Itoa(basePort)

	// If an instance is already running on the base port, ask it to
	// open a new browser tab instead of starting a second instance.
	if isPortInUse(port) {
		openURL := fmt.Sprintf("http://localhost:%s/api/open", port)
		resp, err := http.Get(openURL)
		if err == nil {
			resp.Body.Close()
		}
		os.Exit(0)
	}

	url := fmt.Sprintf("http://localhost:%s", port)
	server := setupServer(port)

	// Signal when the HTTP server exits (clean shutdown or fatal error).
	serverDone := make(chan struct{})
	go func() {
		fmt.Printf("Server listening on %s\n", url)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
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
