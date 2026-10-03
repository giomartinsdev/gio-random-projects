// domain-api is the synchronous read path (GET straight from Postgres)
// and the entry point for writes, which it never applies itself — see
// internal/infrastructure/http's package doc for why.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	inamqp "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/amqp"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/config"
	httpapi "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/http"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/postgres"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/telemetry"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const shutdownTimeout = 10 * time.Second

func main() {
	log := slog.New(telemetry.NewLogger(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config error", "error", err)
		os.Exit(1)
	}
	apiKeys := httpapi.ParseAPIKeys(cfg.APIKeys)
	rateLimiter := httpapi.NewIPRateLimiter(cfg.RateLimitRPS, cfg.RateLimitBurst)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Telemetry failing to start must never take the API down — degrade
	// to no telemetry and carry on. Empty OTEL_EXPORTER_OTLP_ENDPOINT
	// (local dev) skips init entirely; see internal/telemetry.
	shutdownTelemetry, err := telemetry.Init(ctx, "domain-api")
	if err != nil {
		log.Error("telemetry init failed; continuing without it", "error", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	pool, err := postgres.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db connect error", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := postgres.Migrate(ctx, pool); err != nil {
		log.Error("migration error", "error", err)
		os.Exit(1)
	}

	bus, err := inamqp.Dial(cfg.RabbitMQURL)
	if err != nil {
		log.Error("rabbitmq connect error", "error", err)
		os.Exit(1)
	}
	defer bus.Close()

	commands, err := inamqp.NewCommandPublisher(bus)
	if err != nil {
		log.Error("command publisher error", "error", err)
		os.Exit(1)
	}
	defer commands.Close()

	// /sync polls audit_log — the worker's unconditional per-command
	// audit row is its "written" proof.
	audits := postgres.NewAuditRepository(pool)
	syncHandlers := httpapi.NewSyncHandlers(commands, audits, log)

	// FC Clubs Hub (specs/003): read models + the write doors the clubs
	// services call. domain-api is read-only against these tables --
	// domain-worker is the sole writer, as everywhere else in this repo.
	clubsRepo := postgres.NewClubsRepository(pool)
	clubsHandlers := httpapi.NewClubsHandlers(clubsRepo, log)
	clubsWriteHandlers := httpapi.NewClubsWriteHandlers(commands, log)

	handlers := httpapi.NewHandlers(log)

	router := httpapi.NewRouter(handlers, syncHandlers, clubsHandlers, clubsWriteHandlers, apiKeys, rateLimiter, log)

	server := &http.Server{Addr: cfg.HTTPAddr, Handler: otelhttp.NewHandler(router, "domain-api",
		// chi's route patterns aren't visible to otelhttp, so name the
		// span from the request itself — "POST /posts" reads far better
		// in Tempo than every span sharing the operation name.
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}),
	)}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Info("domain-api listening", "addr", cfg.HTTPAddr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Error("server error", "error", err)
		os.Exit(1)
	}
}
