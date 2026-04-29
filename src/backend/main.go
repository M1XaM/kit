package main

import (
"flag"
"fmt"
"log"
"net/http"
"os"
"time"
)

func main() {
showTerm := flag.Bool("term", true, "Show terminal with logs when launched via URL scheme")
flag.Parse()

registerCustomScheme(*showTerm)

port := "8080"
url := fmt.Sprintf("http://localhost:%s", port)

if isPortInUse(port) {
fmt.Println("Server is already running on port 8080. Redirecting browser to exist instance...")
openBrowser(url)
os.Exit(0)
}

server := setupServer(port)

go func() {
fmt.Printf("Server listening on %s\n", url)
if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
log.Fatalf("Server error: %v", err)
}
}()

go openBrowser(url)

time.Sleep(15 * time.Second)

monitorConnections()

select {}
}
