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
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/clips"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/metrics"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/sfu"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/telemetry"
)

func main() {
	// JSON slog (not the stdlib logger this used to use) so the line
	// lands in Loki as structured fields — level gets a label, and the
	// telemetry handler stamps trace_id/span_id onto anything logged
	// inside a request span.
	log := slog.New(telemetry.NewLogger(slog.NewJSONHandler(os.Stdout, nil)))

	shutdownTelemetry, err := telemetry.Init(context.Background(), "tela-api")
	if err != nil {
		// Telemetry failing to start must never stop the signalling
		// server — degrade to no telemetry and carry on. Empty
		// OTEL_EXPORTER_OTLP_ENDPOINT (local dev) skips init entirely.
		log.Error("telemetry init failed; continuing without it", "error", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

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
		log.Error("could not start the SFU", "error", err)
		os.Exit(1)
	}
	if media.PublicIP() == "" {
		// Worth shouting about: without this the SFU advertises the
		// container's private address and no browser can connect, which
		// otherwise shows up only as video that never starts.
		log.Warn("SFU_PUBLIC_HOST is not set -- browsers will not be able to reach the SFU")
	} else {
		log.Info("sfu started", "udp_port", sfuPort, "public_ip", media.PublicIP(), "public_host", os.Getenv("SFU_PUBLIC_HOST"))
	}

	registry := rooms.NewRegistry(statePath)
	if err := registry.Load(); err != nil {
		// Losing rooms is bad; refusing to boot is worse.
		log.Warn("could not restore rooms", "state_file", statePath, "error", err)
	} else if statePath != "" {
		log.Info("rooms restored", "state_file", statePath, "count", registry.Count())
	}
	stopJanitor := make(chan struct{})
	registry.StartJanitor(stopJanitor)
	defer close(stopJanitor)

	// Prometheus scraping is opt-in: off by default, and off means the
	// /metrics route isn't registered at all rather than erroring. The
	// gauges read the room registry at scrape time (internal/metrics).
	var metricsHandler http.Handler
	if envBool("TELA_METRICS", false) {
		metricsHandler = metrics.New(registry)
		log.Info("metrics on", "path", "/metrics")
	}

	// Clips: the upload endpoint is always on (the publisher's browser
	// records the last 5 minutes and POSTs the finished WebM), but
	// WHERE the bytes live is configurable. With TELA_S3_* set they go
	// to MinIO and survive restarts; without it they stay in RAM and
	// die with the process. A broken S3 config degrades to RAM with a
	// loud warning rather than refusing to boot -- clips are a
	// convenience, and telas without clips are worse than telas with
	// temporary clips.
	clipTTL := envDuration("TELA_CLIP_TTL", 7*24*time.Hour)
	var clipStore clips.Store
	if endpoint := os.Getenv("TELA_S3_ENDPOINT"); endpoint != "" {
		store, err := clips.NewS3Store(endpoint,
			env("TELA_S3_ACCESS_KEY", ""), env("TELA_S3_SECRET_KEY", ""),
			env("TELA_S3_BUCKET", "tela-clips"), envBool("TELA_S3_SECURE", true))
		if err != nil {
			log.Warn("S3 de clips indisponivel; usando memoria (clips morrem com o processo)", "error", err)
			clipStore = clips.NewMemoryStore()
		} else {
			clipStore = store
			log.Info("clips no S3", "endpoint", endpoint, "bucket", env("TELA_S3_BUCKET", "tela-clips"))
		}
	} else {
		clipStore = clips.NewMemoryStore()
		log.Info("clips em memoria", "ttl", clipTTL.String())
	}

	// Clips expirados saem do storage no mesmo relógio do janitor.
	clips.StartSweeper(context.Background(), clipStore, time.Minute, stopJanitor,
		func(msg string, removed int) { log.Info(msg, "removed", removed) })

	// A room where nobody has shared for a while gets one warning
	// (room:closing with a countdown) and then closes for everyone --
	// the client navigates home on room:closed. Both knobs exist as env
	// so the whole lifecycle is exercisable in milliseconds by tests
	// and so a deployment can be more patient than the default.
	idleTimeout := envDuration("TELA_ROOM_IDLE_TIMEOUT", 15*time.Minute)
	idleGrace := envDuration("TELA_ROOM_IDLE_GRACE", time.Minute)
	registry.StartIdleReaper(stopJanitor, idleTimeout, idleGrace)
	log.Info("idle reaper on", "idle_timeout", idleTimeout.String(), "grace", idleGrace.String())

	// Host networking (see the container's own docs) means this binds
	// straight onto the VPS's interfaces -- BIND_HOST lets the ingress
	// deployment keep it off everything but loopback, since nginx is
	// the only thing meant to reach it directly. Empty (bare metal /
	// dev) falls back to every interface, same as before this existed.
	api := httpapi.New(registry, media, allowedOrigins, log, metricsHandler)
	api.RegisterClips(clipStore, clipTTL)
	server := &http.Server{
		Addr:    os.Getenv("BIND_HOST") + ":" + port,
		Handler: api.Handler(),
		// No WriteTimeout: a WebSocket connection is meant to stay open
		// for as long as the screen share lasts, and WriteTimeout would
		// cut it off. Per-write deadlines in the WS write loop cover the
		// stuck-client case instead.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Info("listening", "port", port, "allowed_origins", allowedOrigins)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Info("shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Error("graceful shutdown failed", "error", err)
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

// envBool reads a feature flag: "1"/"true"/"yes" (case-insensitive) on,
// anything else -- including unset -- off.
func envBool(key string, fallback bool) bool {
	v := strings.ToLower(os.Getenv(key))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes"
}

// envDuration parses a Go duration ("15m", "90s"). Unset, malformed
// or non-positive falls back -- configuration being wrong must never
// disable a safety behavior silently different from its default.
func envDuration(key string, fallback time.Duration) time.Duration {
	v, err := time.ParseDuration(os.Getenv(key))
	if err != nil || v <= 0 {
		return fallback
	}
	return v
}
