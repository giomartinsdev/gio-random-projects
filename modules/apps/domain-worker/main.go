// domain-worker is the only binary that ever calls domain/user.Repository's
// mutating methods. It runs two concurrent loops — the bus Relay
// (bridges the pub/sub command channel into the durable queue) and the
// processing loop below (pops a command, applies it via
// internal/application/user's CommandHandler, records an
// internal/application/audit entry, publishes the resulting domain
// event).
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	goredis "github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/audit"
	appuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/user"
	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/user"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/config"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
	inredis "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/redis"
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

	relay := inredis.NewRelay(rdb)
	commandQueue := inredis.NewCommandQueue(rdb)
	eventBus := inredis.NewEventBus(rdb)

	userRepo := postgres.NewUserRepository(pool)
	auditRepo := postgres.NewAuditRepository(pool)
	userService := appuser.NewService(userRepo)
	userHandler := appuser.NewCommandHandler(userService)

	errCh := make(chan error, 1)
	go func() {
		log.Info("relay started")
		if err := relay.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			errCh <- err
		}
	}()

	go func() {
		log.Info("processing loop started")
		for {
			cmd, err := commandQueue.Next(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, goredis.ErrClosed) {
					return
				}
				log.Error("fetch command error", "error", err)
				continue
			}
			process(ctx, log, userHandler, auditRepo, eventBus, cmd)
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

// process runs one command through the aggregate's CommandHandler, then
// always records an audit entry (success or failure) and, only on
// success, publishes the resulting domain event.
func process(ctx context.Context, log *slog.Logger, handler *appuser.CommandHandler, audits audit.Repository, eventBus *inredis.EventBus, cmd application.Command) {
	evt, err := handler.Handle(ctx, cmd)

	entry := audit.Entry{
		CommandID:  cmd.ID,
		EntityType: "user",
		EntityID:   entityID(evt),
		Action:     string(cmd.Action),
		Payload:    cmd.Payload,
		Success:    err == nil,
	}
	if err != nil {
		entry.Error = err.Error()
		log.Error("command failed", "error", err, "command_id", cmd.ID, "action", cmd.Action)
	} else if evt != nil {
		if err := eventBus.Publish(ctx, evt); err != nil {
			log.Error("publish event failed", "error", err, "command_id", cmd.ID)
		}
	}
	if err := audits.Record(ctx, entry); err != nil {
		log.Error("audit write failed", "error", err, "command_id", cmd.ID)
	}
}

// entityID pulls the affected user's ID out of the domain event for the
// audit row — the only place that needs it, since Create doesn't know
// its own generated ID until the event comes back from the handler.
func entityID(evt domainuser.Event) string {
	switch e := evt.(type) {
	case domainuser.Created:
		return e.UserID
	case domainuser.Updated:
		return e.UserID
	case domainuser.Deleted:
		return e.UserID
	default:
		return ""
	}
}
