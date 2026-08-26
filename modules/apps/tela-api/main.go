// tela-api: the signalling/SFU backend for screen sharing with a link
// and a password. No accounts, no database -- a room is a code, a
// password and whoever is connected to it right now. The React
// frontend is a separate app (tela-frontend, its own container and
// origin) that talks to this one over CORS -- see internal/httpapi.
//
// Video never passes through this process. Browsers connect to each
// other directly over WebRTC; all this server does is hand offers,
// answers and ICE candidates between them (see internal/httpapi/ws.go).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/sfu"
)

func main() {
	port := env("PORT", "8000")
	// tela-frontend's own origin(s), comma-separated -- same convention
	// as bookclub-api/post-api/classroom-api's FRONTEND_ORIGINS. Empty
	// means nothing is allowed cross-origin: the API works from curl/
	// server-to-server, but no browser page can call it.
	var allowedOrigins []string
	if v := os.Getenv("FRONTEND_ORIGINS"); v != "" {
		allowedOrigins = strings.Split(v, ",")
	}
	// Rooms outlive a restart so a deploy doesn't end sessions that are
	// in progress. Unset means memory only -- fine for local dev, but in
	// production this should point at a volume.
	statePath := env("STATE_FILE", "")

	// Media is forwarded by the SFU rather than meshed between browsers,
	// so this process is a WebRTC endpoint now: it needs a UDP port
	// browsers can reach, and it has to advertise an address they can
	// actually get to. Inside Docker that's the HOST's address, not the
	// container's. A hostname works and is resolved at startup -- but it
	// must resolve to this machine, so a proxied record (which resolves
	// to the proxy) is exactly the wrong thing to point at it.
	sfuPort := envInt("SFU_UDP_PORT", 7881)
	media, err := sfu.New(sfu.Options{
		PublicHost: os.Getenv("SFU_PUBLIC_HOST"),
		UDPPort:    sfuPort,
		STUNURLs:   []string{"stun:stun.l.google.com:19302"},
	})
	if err != nil {
		log.Fatalf("could not start the SFU: %v", err)
	}
	if media.PublicIP() == "" {
		// Worth shouting about: without this the SFU advertises the
		// container's private address and no browser can connect, which
		// otherwise shows up only as video that never starts.
		log.Printf("WARNING: SFU_PUBLIC_HOST is not set -- browsers will not be able to reach the SFU")
	} else {
		log.Printf("sfu on udp/%d advertising %s (from %q)", sfuPort, media.PublicIP(), os.Getenv("SFU_PUBLIC_HOST"))
	}

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
	// dev) falls back to every interface, same as before this existed.
	server := &http.Server{
		Addr:    os.Getenv("BIND_HOST") + ":" + port,
		Handler: httpapi.New(registry, media, allowedOrigins).Handler(),
		// No WriteTimeout: a WebSocket connection is meant to stay open
		// for as long as the screen share lasts, and WriteTimeout would
		// cut it off. Per-write deadlines in the WS write loop cover the
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

func envInt(key string, fallback int) int {
	v, err := strconv.Atoi(os.Getenv(key))
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}
