// cch-api: the backend for cch.giomartins.dev, a Cards Against
// Humanity-style party game. No accounts, no database -- a room is a
// code, a password and whoever is connected to it right now. The React
// frontend is a separate app (cch-frontend, its own origin) that talks
// to this one over CORS -- see internal/httpapi.
//
// All game state lives here: the rules engine (internal/game), the
// room registry with its WebSockets (internal/rooms) and the card
// decks (internal/decks). One process per concern is enough for a
// party game.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/rooms"
)

func main() {
	port := env("PORT", "8008")
	// cch-frontend's own origin(s), comma-separated -- same convention
	// as tela-api's FRONTEND_ORIGINS. Empty means nothing is allowed
	// cross-origin: the API works from curl/server-to-server, but no
	// browser page can call it.
	var allowedOrigins []string
	if v := os.Getenv("FRONTEND_ORIGINS"); v != "" {
		allowedOrigins = strings.Split(v, ",")
	}
	// Rooms outlive a restart so a deploy doesn't end sessions that are
	// in progress. Unset means memory only -- fine for local dev, but in
	// production this should point at a volume.
	statePath := env("STATE_FILE", "")

	registry := rooms.NewRegistry(statePath)
	if err := registry.Load(); err != nil {
		// Losing rooms is bad; refusing to boot is worse.
		log.Printf("could not restore rooms from %q: %v", statePath, err)
	} else if statePath != "" {
		log.Printf("rooms restored from %q: %d", statePath, registry.Count())
	}
	stopJanitor := make(chan struct{})
	registry.StartJanitor(stopJanitor)
	defer close(stopJanitor)

	// Host networking (see the container's own docs) means this binds
	// straight onto the VPS's interfaces -- BIND_HOST lets the ingress
	// deployment keep it off everything but loopback, since nginx is
	// the only thing meant to reach it directly. Empty (bare metal /
	// dev) falls back to every interface, same as tela-api.
	server := &http.Server{
		Addr:    os.Getenv("BIND_HOST") + ":" + port,
		Handler: httpapi.New(registry, allowedOrigins).Handler(),
		// No WriteTimeout: a WebSocket connection is meant to stay open
		// for as long as the game lasts, and WriteTimeout would cut it
		// off. Per-write deadlines in the WS write loop cover the
		// stuck-client case instead.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (allowed origins: %v)", port, allowedOrigins)
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