// domain-api is the synchronous read path (GET straight from Postgres)
// and the entry point for writes, which it never applies itself — see
// internal/apihttp's package doc for why.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/apihttp"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/config"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/dbpkg"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/events"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/userrepo"
)

const shutdownTimeout = 10 * time.Second

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config error", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := dbpkg.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db connect error", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := dbpkg.Migrate(ctx, pool); err != nil {
		log.Error("migration error", "error", err)
		os.Exit(1)
	}

	rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr, Password: cfg.RedisPass})
	defer rdb.Close()

	bus := events.NewBus(rdb)
	users := userrepo.NewRepository(pool)
	handlers := apihttp.NewHandlers(users, bus, log)
	router := apihttp.NewRouter(handlers)

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
