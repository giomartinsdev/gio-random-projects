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
	"time"

	goredis "github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/audit"
	appdeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/deal"
	appmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/message"
	apppost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/post"
	approom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/room"
	appuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/user"
	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/deal"
	domainmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/message"
	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/post"
	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/room"
	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/user"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/config"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
	inredis "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/redis"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/telemetry"
)

func main() {
	log := slog.New(telemetry.NewLogger(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config error", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Telemetry failing to start must never stop command processing —
	// degrade to no telemetry and carry on. Empty
	// OTEL_EXPORTER_OTLP_ENDPOINT (local dev) skips init entirely; see
	// internal/telemetry.
	shutdownTelemetry, err := telemetry.Init(ctx, "domain-worker")
	if err != nil {
		log.Error("telemetry init failed; continuing without it", "error", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	if err := telemetry.InitMetrics(); err != nil {
		log.Error("metric init failed; continuing without them", "error", err)
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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

	relay := inredis.NewRelay(rdb)
	commandQueue := inredis.NewCommandQueue(rdb)
	eventBus := inredis.NewEventBus(rdb, int64(cfg.EventsQueueMax))

	userRepo := postgres.NewUserRepository(pool)
	auditRepo := postgres.NewAuditRepository(pool)
	userService := appuser.NewService(userRepo)
	userHandler := appuser.NewCommandHandler(userService)

	postRepo := postgres.NewPostRepository(pool)
	postService := apppost.NewService(postRepo)
	postHandler := apppost.NewCommandHandler(postService)

	roomRepo := postgres.NewRoomRepository(pool)
	roomService := approom.NewService(roomRepo)
	roomHandler := approom.NewCommandHandler(roomService)

	messageRepo := postgres.NewMessageRepository(pool)
	messageService := appmessage.NewService(messageRepo)
	messageHandler := appmessage.NewCommandHandler(messageService)

	dealRepo := postgres.NewDealRepository(pool)
	dealService := appdeal.NewService(dealRepo)
	dealHandler := appdeal.NewCommandHandler(dealService)

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
			process(ctx, log, userHandler, postHandler, roomHandler, messageHandler, dealHandler, auditRepo, eventBus, cmd)
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
// Action prefix ("user." / "post." / "deal."), then always records an
// audit entry (success or failure) and, only on success, publishes the
// resulting domain event. One shared command queue serves every
// aggregate; this is the one place that knows how to fan a Command
// back out to its owning handler.
func process(ctx context.Context, log *slog.Logger, userHandler *appuser.CommandHandler, postHandler *apppost.CommandHandler, roomHandler *approom.CommandHandler, messageHandler *appmessage.CommandHandler, dealHandler *appdeal.CommandHandler, audits audit.Repository, eventBus *inredis.EventBus, cmd application.Command) {
	// One span per command: the handler, the audit write and the event
	// publish below are the whole story of that write, and the
	// trace_id stamped into the log lines ties every one of them to it.
	ctx, span := otel.Tracer("domain-worker").Start(ctx, "process "+string(cmd.Action),
		trace.WithAttributes(
			attribute.String("command.id", cmd.ID),
			attribute.String("command.action", string(cmd.Action)),
		))
	defer span.End()

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
	case strings.HasPrefix(string(cmd.Action), "room."):
		entityType = "room"
		var revt domainroom.Event
		revt, err = roomHandler.Handle(ctx, cmd)
		if revt != nil {
			evt = revt
			id = roomEntityID(revt)
		}
	case strings.HasPrefix(string(cmd.Action), "message."):
		entityType = "message"
		var mevt domainmessage.Event
		mevt, err = messageHandler.Handle(ctx, cmd)
		if mevt != nil {
			evt = mevt
			id = messageEntityID(mevt)
		}
	case strings.HasPrefix(string(cmd.Action), "deal."):
		// The deal handler returns the Deal even when this upsert was
		// an update (which raises no event) — either way the audit row
		// should name the exact source:source_deal_id it touched.
		entityType = "deal"
		var d domaindeal.Deal
		var devt domaindeal.Event
		d, devt, err = dealHandler.Handle(ctx, cmd)
		if devt != nil {
			evt = devt
		}
		if d.Source != "" {
			id = d.EntityID()
			telemetry.RecordDealUpsert(d.Source, map[bool]string{true: "inserted", false: "updated"}[devt != nil])
		}
	default:
		err = fmt.Errorf("unknown action: %q", cmd.Action)
	}

	switch {
	case err != nil:
		telemetry.RecordCommand(string(cmd.Action), "error")
	default:
		telemetry.RecordCommand(string(cmd.Action), "ok")
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
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		entry.Error = err.Error()
		log.ErrorContext(ctx, "command failed", "error", err, "command_id", cmd.ID, "action", cmd.Action)
	} else if evt != nil {
		if pubErr := eventBus.Publish(ctx, evt); pubErr != nil {
			span.RecordError(pubErr)
			log.ErrorContext(ctx, "publish event failed", "error", pubErr, "command_id", cmd.ID)
		}
	}
	if auditErr := audits.Record(ctx, entry); auditErr != nil {
		span.RecordError(auditErr)
		log.ErrorContext(ctx, "audit write failed", "error", auditErr, "command_id", cmd.ID)
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

func roomEntityID(evt domainroom.Event) string {
	switch e := evt.(type) {
	case domainroom.Created:
		return e.RoomID
	case domainroom.Updated:
		return e.RoomID
	case domainroom.Deleted:
		return e.RoomID
	default:
		return ""
	}
}

func messageEntityID(evt domainmessage.Event) string {
	switch e := evt.(type) {
	case domainmessage.Created:
		return e.MessageID
	default:
		return ""
	}
}
