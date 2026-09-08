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
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/ai"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/customdecks"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/domainapi"
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
	// Rooms and decks outlive a restart so a deploy doesn't end sessions
	// that are in progress. The durable home is domain-api (DOMAIN_API_URL
	// + DOMAIN_API_KEY): rooms go to its cch_rooms table, decks to
	// cch_custom_decks. Unset means memory only -- fine for local dev.
	//
	// STATE_FILE is the legacy JSON store from before the cutover; it's
	// now only an import source: if the domain table is empty and the
	// file is there, its contents are pushed through the sync route once
	// and the file renamed to *.imported (see import_legacy.go).
	statePath := env("STATE_FILE", "")
	client := domainapi.NewFromEnv()
	if client.Enabled() {
		log.Printf("persistência via domain-api (%s)", os.Getenv("DOMAIN_API_URL"))
	} else if statePath != "" {
		log.Printf("STATE_FILE set but DOMAIN_API_URL missing: the legacy JSON store is ignored, rooms are memory-only")
	}

	// Import BEFORE loading: the load pulls from domain, so anything the
	// import just pushed must already be there to be seen this boot.
	importLegacyRooms(client, statePath)

	var roomPersister rooms.Persister
	if client.Enabled() {
		roomPersister = rooms.NewDomainPersister(client)
	}
	registry := rooms.NewRegistry(roomPersister)
	if err := registry.Load(); err != nil {
		// Losing rooms is bad; refusing to boot is worse.
		log.Printf("could not restore rooms: %v", err)
	} else if roomPersister != nil {
		log.Printf("rooms restored: %d", registry.Count())
	}
	stopJanitor := make(chan struct{})
	registry.StartJanitor(stopJanitor)
	defer close(stopJanitor)

	// The deck marketplace lives next to the room registry. Same
	// cutover: CUSTOM_DECKS_FILE (or STATE_FILE's directory, the old
	// default) is an import source only.
	decksPath := env("CUSTOM_DECKS_FILE", "")
	if decksPath == "" && statePath != "" {
		decksPath = filepath.Join(filepath.Dir(statePath), "custom-decks.json")
	}
	importLegacyDecks(client, decksPath)

	var deckBackend customdecks.Backend
	if client.Enabled() {
		deckBackend = customdecks.NewDomainBackend(client)
	}
	forge := customdecks.New(deckBackend)
	if err := forge.Load(); err != nil {
		log.Printf("could not restore custom decks: %v", err)
	} else if deckBackend != nil {
		if n := len(forge.List()); n > 0 {
			log.Printf("custom decks restored: %d", n)
		}
	}

	// The AI writer: unset CCH_AI_BASE_URL means the forge's generate
	// button answers "IA não configurada" and everything else works.
	aiClient := ai.NewFromEnv()
	if aiClient.Enabled() {
		log.Printf("deck forge enabled (ai base %s, model %q)", aiClient.BaseURL(), aiClient.Model())
	}

	// Host networking (see the container's own docs) means this binds
	// straight onto the VPS's interfaces -- BIND_HOST lets the ingress
	// deployment keep it off everything but loopback, since nginx is
	// the only thing meant to reach it directly. Empty (bare metal /
	// dev) falls back to every interface, same as tela-api.
	server := &http.Server{
		Addr:    os.Getenv("BIND_HOST") + ":" + port,
		Handler: httpapi.New(registry, allowedOrigins, aiClient, forge).Handler(),
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