package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	upgrader    = websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	activeConns = 0
	connsMutex  sync.Mutex
)

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	defer conn.Close()

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

func monitorConnections() {
	go func() {
		zeroConnSince := time.Time{}
		for {
			time.Sleep(1 * time.Second)
			connsMutex.Lock()
			count := activeConns
			connsMutex.Unlock()

			if count == 0 {
				if zeroConnSince.IsZero() {
					zeroConnSince = time.Now()
				} else if time.Since(zeroConnSince) > 5*time.Second {
					fmt.Println("No active connections for 5 seconds. Shutting down to free up OS memory...")
					os.Exit(0)
				}
			} else {
				zeroConnSince = time.Time{} // reset
			}
		}
	}()
}
