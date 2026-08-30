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

	goredis "github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/config"
	httpapi "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/http"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/postgres"
	inredis "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/redis"
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

	rdb := goredis.NewClient(&goredis.Options{Addr: cfg.RedisAddr, Password: cfg.RedisPass})
	defer rdb.Close()

	users := postgres.NewUserRepository(pool)
	commands := inredis.NewCommandPublisher(rdb)
	handlers := httpapi.NewHandlers(users, commands, log)

	posts := postgres.NewPostRepository(pool)
	postHandlers := httpapi.NewPostHandlers(posts, commands, log)

	rooms := postgres.NewRoomRepository(pool)
	roomHandlers := httpapi.NewRoomHandlers(rooms, commands, log)

	messages := postgres.NewMessageRepository(pool)
	messageHandlers := httpapi.NewMessageHandlers(messages, commands, log)

	deals := postgres.NewDealRepository(pool)
	dealHandlers := httpapi.NewDealHandlers(deals, commands, log)

	// A dedicated client for SSE's Redis SUBSCRIBE -- go-redis dedicates
	// a connection per subscription for the life of that subscription,
	// so this stays separate from rdb (which CommandPublisher uses for
	// plain PUBLISH calls) rather than contending with it.
	sseRDB := goredis.NewClient(&goredis.Options{Addr: cfg.RedisAddr, Password: cfg.RedisPass})
	defer sseRDB.Close()
	sseHandlers := httpapi.NewSSEHandlers(sseRDB, log)

	router := httpapi.NewRouter(handlers, postHandlers, roomHandlers, messageHandlers, dealHandlers, sseHandlers, apiKeys, rateLimiter, log)

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
