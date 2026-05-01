package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

func main() {
	showTerm := flag.Bool("term", true, "Show terminal with logs when launched via URL scheme")
	flag.Parse()

	registerCustomScheme(*showTerm)

	basePort := 8080
	selectedPort, usedFallbackPort := chooseLaunchPort(basePort)
	port := strconv.Itoa(selectedPort)
	url := fmt.Sprintf("http://localhost:%s", port)

	if usedFallbackPort {
		fmt.Printf("Primary port %d is busy. Starting a new instance on port %d...\n", basePort, selectedPort)
	}

	server := setupServer(port)

	go func() {
		fmt.Printf("Server listening on %s\n", url)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	go func() {
		if waitForServerReady(url, 5*time.Second) {
			openBrowserWithRetry(url, 3, 400*time.Millisecond)
			return
		}
		// Even if readiness checks fail, still attempt to open.
		openBrowserWithRetry(url, 5, 700*time.Millisecond)
	}()

	time.Sleep(15 * time.Second)

	monitorConnections(selectedPort, basePort)

	select {}
}
