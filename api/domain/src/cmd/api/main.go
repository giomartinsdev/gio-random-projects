// domain-api is the composition root for the synchronous read path
// (GET straight from Postgres) and the entry point for writes, which it
// never applies itself — see infrastructure/http's package doc for why.
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

	"github.com/giomartinsdev/gio-random-projects/api/domain/src/infrastructure/config"
	httpapi "github.com/giomartinsdev/gio-random-projects/api/domain/src/infrastructure/http"
	"github.com/giomartinsdev/gio-random-projects/api/domain/src/infrastructure/postgres"
	infraredis "github.com/giomartinsdev/gio-random-projects/api/domain/src/infrastructure/redis"
)

const shutdownTimeout = 10 * time.Second

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config error", "error", err)
		os.Exit(1)
	}
	if cfg.APIKeys == "" {
		log.Error("config error", "error", "DOMAIN_API_KEYS is required (this service is internet-facing)")
		os.Exit(1)
	}
	apiKeys := httpapi.ParseAPIKeys(cfg.APIKeys)
	rateLimiter := httpapi.NewIPRateLimiter(cfg.RateLimitRPS, cfg.RateLimitBurst)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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
	commands := infraredis.NewCommandBus(rdb)
	handlers := httpapi.NewHandlers(users, commands, log)
	router := httpapi.NewRouter(handlers, apiKeys, rateLimiter, log)

	server := &http.Server{Addr: cfg.HTTPAddr, Handler: router}

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
