// domain-worker is the only binary that ever mutates the domain tables.
// It runs one processing loop: RabbitMQ delivers a
// command from the durable domain.commands.queue, the loop applies it
// via the matching aggregate's CommandHandler, records an
// internal/application/audit entry, and publishes the resulting domain
// event to the domain.events exchange.
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

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/audit"
	appfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/finance"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/outbox"
	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/finance"
	inamqp "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/amqp"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/config"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
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

	bus, err := inamqp.Dial(cfg.RabbitMQURL)
	if err != nil {
		log.Error("rabbitmq connect error", "error", err)
		os.Exit(1)
	}
	defer bus.Close()

	eventBus, err := inamqp.NewEventBus(bus, cfg.EventsQueueMax)
	if err != nil {
		log.Error("event bus error", "error", err)
		os.Exit(1)
	}
	defer eventBus.Close()

	commandQueue, err := inamqp.NewCommandQueue(bus)
	if err != nil {
		log.Error("command queue error", "error", err)
		os.Exit(1)
	}

	auditRepo := postgres.NewAuditRepository(pool)

	// Outbox durável (§4.3): cada evento vira uma linha pendente ANTES da
	// tentativa de publish, então um broker fora do ar não perde um evento já
	// aplicado. O relay em background reescreve os pendentes quando ele volta.
	outboxRepo := postgres.NewOutboxRepository(pool)
	relay := outbox.NewRelay(outboxRepo, eventBus, log)
	go relay.Run(ctx, 5*time.Second)

	// FC Clubs Hub (specs/003) e Prospecta (specs/004) foram removidos: os
	// apps que os consumiam (clubs-api/ingest, prospecta-api/worker) saíram
	// junto, então o worker só aplica o contexto financeiro agora.

	// Financeiro (docs/finance-system-spec.md): a finance-api relaya o comando,
	// o worker aplica e grava a auditoria. Sem banco na ACL — a escrita é toda
	// aqui (§1.1).
	financeRepo := postgres.NewFinanceRepository(pool)
	financeService := appfinance.NewService(financeRepo)
	financeHandler := appfinance.NewCommandHandler(financeService)

	// Every aggregate's handler in one place: process() takes this
	// struct rather than a growing parameter list.
	hs := handlers{
		finance: financeHandler,
	}

	go func() {
		log.Info("processing loop started")
		for {
			cmd, err := commandQueue.Next(ctx)
			if err != nil {
				if errors.Is(err, context.Canceled) {
					return
				}
				log.Error("fetch command error", "error", err)
				continue
			}
			process(ctx, log, hs, auditRepo, relay, cmd)
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
}

// process routes cmd to the right aggregate's CommandHandler by its
// Action family ("club." / "partida." / the clubs.* queue actions), then
// always records an audit entry (success or failure) and, only on success,
// publishes the resulting domain event. One shared command queue serves
// every aggregate; this is the one place that knows how to fan a Command
// back out to its owning handler.
// handlers bundles the wireable CommandHandlers. Só o financeiro sobrou depois
// da remoção de clubs/prospecta; o struct fica porque é o ponto onde um novo
// agregado entra sem mexer na assinatura de process().
type handlers struct {
	// Financeiro (finance.*): o handler devolve uma LISTA de eventos (um
	// comando de orçamento pode cruzar várias réguas), por isso o case dele é
	// tratado à parte no process().
	finance *appfinance.CommandHandler
}

func process(ctx context.Context, log *slog.Logger, h handlers, audits audit.Repository, relay *outbox.Relay, cmd application.Command) {
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
		err        error
		entityType string
		id         string
		// O financeiro devolve N eventos (réguas de orçamento). Ficam aqui e
		// são publicados todos num único lote no outbox.
		financeEvents []domainfinance.Event
	)

	switch {
	case strings.HasPrefix(string(cmd.Action), "finance."):
		// Financeiro (§4.1): o handler devolve N eventos (réguas de orçamento
		// podem cruzar várias de uma vez). O id da entidade vem do próprio
		// payload/evento -- não há um agregado único. Publicamos todos aqui.
		entityType = "finance"
		var events []domainfinance.Event
		events, err = h.finance.Handle(ctx, cmd)
		if err == nil {
			financeEvents = events
			if len(events) > 0 {
				id = financeEntityID(events[0])
			}
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
	} else {
		// Publica via outbox durável (§4.3/§12.5): grava pendente antes de
		// tentar. Um broker fora do ar deixa a linha pendente para o relay —
		// a escrita já aplicada nunca se perde. Relay.Publish devolve erro só
		// quando o ENQUEUE falha (marshal/DB), não quando o publish atrasa.
		events := make([]outbox.Event, 0, len(financeEvents))
		for _, fe := range financeEvents {
			events = append(events, fe)
		}
		if pubErr := relay.Publish(ctx, cmd.ID, events); pubErr != nil {
			span.RecordError(pubErr)
			entry.Error = pubErr.Error()
			entry.Success = false
			log.ErrorContext(ctx, "outbox enqueue failed", "error", pubErr, "command_id", cmd.ID)
		}
	}
	if auditErr := audits.Record(ctx, entry); auditErr != nil {
		span.RecordError(auditErr)
		log.ErrorContext(ctx, "audit write failed", "error", auditErr, "command_id", cmd.ID)
	}
}

// financeEntityID extrai o id relevante de um evento financeiro para a linha
// de auditoria: a transação (registered/categorized), a transferência, ou a
// régua de orçamento. Um evento que não casa devolve "".
func financeEntityID(evt domainfinance.Event) string {
	switch e := evt.(type) {
	case domainfinance.TransactionRegistered:
		return e.TransactionID
	case domainfinance.TransactionCategorized:
		return e.TransactionID
	case domainfinance.TransferCompleted:
		return e.TransactionID
	case domainfinance.BudgetThresholdReached:
		return e.BudgetID
	default:
		return ""
	}
}
