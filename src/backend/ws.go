package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	upgrader    = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024}
	activeConns = 0
	connsMutex  sync.Mutex
)

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	connsMutex.Lock()
	if activeConns >= 8 {
		connsMutex.Unlock()
		http.Error(w, "Too many active websocket connections", http.StatusTooManyRequests)
		return
	}
	connsMutex.Unlock()

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	defer conn.Close()

	conn.SetReadLimit(1024)
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	})

	connsMutex.Lock()
	activeConns++
	fmt.Printf("Client connected. Active connections: %d\n", activeConns)
	connsMutex.Unlock()

	defer func() {
		connsMutex.Lock()
		activeConns--
		fmt.Printf("Client disconnected. Active connections: %d\n", activeConns)
		connsMutex.Unlock()
	}()

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func monitorConnections(currentPort int, basePort int) {
	go func() {
		zeroConnSince := time.Time{}
		fallbackIdleSince := time.Time{}
		basePortStr := strconv.Itoa(basePort)

		for {
			time.Sleep(1 * time.Second)
			connsMutex.Lock()
			count := activeConns
			connsMutex.Unlock()

			if count == 0 {
				if zeroConnSince.IsZero() {
					zeroConnSince = time.Now()
				} else if time.Since(zeroConnSince) > 3*time.Second {
					fmt.Println("No active connections for 3 seconds. Shutting down to free up OS memory...")
					os.Exit(0)
				}

				// If this is a fallback instance, release it once the primary port becomes free.
				if currentPort != basePort && !isPortInUse(basePortStr) {
					if fallbackIdleSince.IsZero() {
						fallbackIdleSince = time.Now()
					} else if time.Since(fallbackIdleSince) > 2*time.Second {
						fmt.Printf("Primary port %d is free again. Shutting down fallback instance on port %d...\n", basePort, currentPort)
						os.Exit(0)
					}
				} else {
					fallbackIdleSince = time.Time{}
				}
			} else {
				zeroConnSince = time.Time{} // reset
				fallbackIdleSince = time.Time{}
			}
		}
	}()
}
