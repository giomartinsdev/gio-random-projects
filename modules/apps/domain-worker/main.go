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
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	goredis "github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/audit"
	apppost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/post"
	appuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/user"
	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/post"
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

	postRepo := postgres.NewPostRepository(pool)
	postService := apppost.NewService(postRepo)
	postHandler := apppost.NewCommandHandler(postService)

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
			process(ctx, log, userHandler, postHandler, auditRepo, eventBus, cmd)
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

// process routes cmd to the right aggregate's CommandHandler by its
// Action prefix ("user." / "post."), then always records an audit
// entry (success or failure) and, only on success, publishes the
// resulting domain event. One shared command queue serves every
// aggregate; this is the one place that knows how to fan a Command
// back out to its owning handler.
func process(ctx context.Context, log *slog.Logger, userHandler *appuser.CommandHandler, postHandler *apppost.CommandHandler, audits audit.Repository, eventBus *inredis.EventBus, cmd application.Command) {
	var (
		evt        interface{ EventName() string }
		err        error
		entityType string
		id         string
	)

	switch {
	case strings.HasPrefix(string(cmd.Action), "user."):
		entityType = "user"
		var uevt domainuser.Event
		uevt, err = userHandler.Handle(ctx, cmd)
		if uevt != nil {
			evt = uevt
			id = userEntityID(uevt)
		}
	case strings.HasPrefix(string(cmd.Action), "post."):
		entityType = "post"
		var pevt domainpost.Event
		pevt, err = postHandler.Handle(ctx, cmd)
		if pevt != nil {
			evt = pevt
			id = postEntityID(pevt)
		}
	default:
		err = fmt.Errorf("unknown action: %q", cmd.Action)
	}

	entry := audit.Entry{
		CommandID:  cmd.ID,
		EntityType: entityType,
		EntityID:   id,
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

// userEntityID/postEntityID pull the affected aggregate's ID out of
// its domain event for the audit row — the only place that needs it,
// since Create doesn't know its own generated ID until the event
// comes back from the handler.
func userEntityID(evt domainuser.Event) string {
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

func postEntityID(evt domainpost.Event) string {
	switch e := evt.(type) {
	case domainpost.Created:
		return e.PostID
	case domainpost.Updated:
		return e.PostID
	case domainpost.Deleted:
		return e.PostID
	default:
		return ""
	}
}
