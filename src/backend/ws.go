package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var (
	upgrader    = websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 1024}
	connsMutex  sync.Mutex
	connections = make(map[*websocket.Conn]struct{})
)

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	connsMutex.Lock()
	if len(connections) >= 8 {
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

	connsMutex.Lock()
	connections[conn] = struct{}{}
	connsMutex.Unlock()

	defer func() {
		connsMutex.Lock()
		delete(connections, conn)
		connsMutex.Unlock()
		conn.Close()
	}()

	conn.SetReadLimit(1024)
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	})

	// Server-side ping keepalive — keeps the connection alive even when
	// the browser throttles client-side timers in background tabs.
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)); err != nil {
					log.Printf("WebSocket ping failed: %v", err)
					return
				}
			}
		}
	}()

	fmt.Printf("Client connected. Active connections: %d\n", len(connections))

	for {
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		_, _, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read ended: %v", err)
			break
		}
	}
}

// monitorConnections watches active WebSocket connections and shuts down the
// server after 5 seconds of inactivity. When kit://start triggers /api/open,
// the new browser tab establishes a fresh WebSocket connection, which resets
// the idle timer — so the restart flow is preserved.
func monitorConnections(server *http.Server) {
	const idleTimeout = 5 * time.Second
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var idleStart time.Time
	idle := false

	for range ticker.C {
		connsMutex.Lock()
		count := len(connections)
		connsMutex.Unlock()

		if count > 0 {
			idle = false
			continue
		}

		if !idle {
			idle = true
			idleStart = time.Now()
			continue
		}

		if time.Since(idleStart) >= idleTimeout {
			log.Println("No active connections for 5 seconds. Shutting down server.")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := server.Shutdown(ctx); err != nil {
				log.Printf("Error during server shutdown: %v", err)
			}
			return
		}
	}
}

// broadcastMessage sends a text message to every connected WebSocket client.
// Write errors are logged but the connection is left in the map — the read
// loop in handleWebSocket will clean it up on the next failed read.
func broadcastMessage(msg []byte) {
	connsMutex.Lock()
	defer connsMutex.Unlock()
	for conn := range connections {
		_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Printf("Broadcast write error: %v", err)
		}
	}
}

// BroadcastFavoritesUpdated notifies all connected browser tabs that the
// favorites order has changed so they can refresh from the server.
func BroadcastFavoritesUpdated() {
	broadcastMessage([]byte(`{"type":"favorites-updated"}`))
}
