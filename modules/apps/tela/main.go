// tela: share your screen with a link and a password. No accounts, no
// database -- a room is a code, a password and whoever is connected to
// it right now.
//
// Video never passes through this process. Browsers connect to each
// other directly over WebRTC; all this server does is hand offers,
// answers and ICE candidates between them (see internal/httpapi/ws.go)
// and serve the React build.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/rooms"
)

func main() {
	port := env("PORT", "8000")
	webDir := env("WEB_DIR", "web")

	registry := rooms.NewRegistry()
	stopJanitor := make(chan struct{})
	registry.StartJanitor(stopJanitor)
	defer close(stopJanitor)

	server := &http.Server{
		Addr:    ":" + port,
		Handler: httpapi.New(registry, webDir).Handler(),
		// No WriteTimeout: a WebSocket connection is meant to stay open
		// for as long as the screen share lasts, and WriteTimeout would
		// cut it off. Per-write deadlines in the WS write loop cover the
		// stuck-client case instead.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (web dir %q)", port, webDir)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server failed: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
