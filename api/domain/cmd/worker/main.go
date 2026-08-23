// domain-worker is the only writer to the users table. It runs two
// concurrent loops: Relay (subscribes CommandChannel, pushes onto
// CommandQueue — the pub/sub-to-durable-queue bridge) and the
// processing loop below (BLPOPs CommandQueue, applies the write, audits
// it, publishes the outcome).
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/audit"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/config"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/dbpkg"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/events"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/models"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/userrepo"
)

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
	audits := audit.NewRepository(pool)

	errCh := make(chan error, 1)
	go func() {
		log.Info("relay started")
		if err := bus.Relay(ctx); err != nil && !errors.Is(err, context.Canceled) {
			errCh <- err
		}
	}()

	go func() {
		log.Info("processing loop started")
		for {
			cmd, err := bus.NextCommand(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, redis.ErrClosed) {
					return
				}
				log.Error("fetch command error", "error", err)
				continue
			}
			handle(ctx, log, users, audits, bus, cmd)
		}
	}()

	select {
	case <-ctx.Done():
		log.Info("shutting down")
	case err := <-errCh:
		log.Error("relay error", "error", err)
		os.Exit(1)
	}
}

func handle(ctx context.Context, log *slog.Logger, users *userrepo.Repository, audits *audit.Repository, bus *events.Bus, cmd events.Command) {
	result, err := apply(ctx, users, cmd)

	entry := audit.Entry{
		CommandID:  cmd.ID,
		EntityType: cmd.EntityType,
		EntityID:   cmd.EntityID,
		Action:     string(cmd.Action),
		Payload:    cmd.Payload,
		Success:    err == nil,
	}
	if err != nil {
		entry.Error = err.Error()
	}
	if auditErr := audits.Record(ctx, entry); auditErr != nil {
		log.Error("audit write failed", "error", auditErr, "command_id", cmd.ID)
	}

	processed := events.Processed{
		CommandID:  cmd.ID,
		EntityType: cmd.EntityType,
		EntityID:   cmd.EntityID,
		Action:     cmd.Action,
		Success:    err == nil,
		Result:     result,
	}
	if err != nil {
		processed.Error = err.Error()
		log.Error("command failed", "error", err, "command_id", cmd.ID, "action", cmd.Action)
	}
	if pubErr := bus.PublishProcessed(ctx, processed); pubErr != nil {
		log.Error("publish processed event failed", "error", pubErr, "command_id", cmd.ID)
	}
}

func apply(ctx context.Context, users *userrepo.Repository, cmd events.Command) (models.User, error) {
	switch cmd.Action {
	case events.ActionCreate:
		input, err := decodeInput(cmd.Payload)
		if err != nil {
			return models.User{}, err
		}
		return users.Create(ctx, cmd.EntityID, input)
	case events.ActionUpdate:
		input, err := decodeInput(cmd.Payload)
		if err != nil {
			return models.User{}, err
		}
		return users.Update(ctx, cmd.EntityID, input)
	case events.ActionDelete:
		return models.User{}, users.Delete(ctx, cmd.EntityID)
	default:
		return models.User{}, errUnknownAction(cmd.Action)
	}
}
