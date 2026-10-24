package outbox

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// Event is any domain event the relay can persist and publish.
type Event interface {
	EventName() string
}

// Bus is the broker edge the relay writes through: it renders the wire
// envelope the outbox stores and publishes already-enveloped bytes.
type Bus interface {
	EnvelopeBytes(eventID, commandID, eventName string, occurredAt time.Time, payload json.RawMessage) ([]byte, error)
	PublishRaw(ctx context.Context, data []byte) error
}

// Relay gives the worker at-least-once event delivery backed by the durable
// outbox (§4.3/§12.5): every event is persisted as pending *before* the publish
// attempt, so a broker outage cannot lose an event whose command was already
// applied. A background loop retries the pending rows until they land;
// consumers stay idempotent by event_id.
type Relay struct {
	repo Repository
	bus  Bus
	log  *slog.Logger

	// namespace makes the event id deterministic from (command_id, event_name,
	// index): re-enqueueing the same logical event is a no-op instead of a
	// duplicate, which is what keeps at-least-once safe across a retry.
	namespace uuid.UUID
	now       func() time.Time
}

func NewRelay(repo Repository, bus Bus, log *slog.Logger) *Relay {
	return &Relay{
		repo:      repo,
		bus:       bus,
		log:       log,
		namespace: uuid.NewSHA1(uuid.NameSpaceOID, []byte("domain-worker.outbox.v1")),
		now:       func() time.Time { return time.Now().UTC() },
	}
}

// Publish persists the events as pending, then attempts an immediate publish.
// The immediate attempt is best-effort: a failure leaves the row pending for
// the background loop, and Publish still returns nil because the write is
// durably recorded — losing the process now cannot lose the event.
func (r *Relay) Publish(ctx context.Context, commandID string, events []Event) error {
	if len(events) == 0 {
		return nil
	}
	entries := make([]Entry, 0, len(events))
	for i, evt := range events {
		payload, err := json.Marshal(evt)
		if err != nil {
			return fmt.Errorf("marshal event %s: %w", evt.EventName(), err)
		}
		occurredAt := r.now()
		// O id determinístico da outbox É o event_id (estável por comando +
		// nome + índice): reentrega carrega o mesmo event_id, e o consumidor
		// at-least-once é idempotente por ele (§12.3/§12.5).
		eventID := uuid.NewSHA1(r.namespace, []byte(fmt.Sprintf("%s|%s|%d", commandID, evt.EventName(), i))).String()
		env, err := r.bus.EnvelopeBytes(eventID, commandID, evt.EventName(), occurredAt, payload)
		if err != nil {
			return err
		}
		entries = append(entries, Entry{
			ID:         eventID,
			EventName:  evt.EventName(),
			Payload:    env,
			OccurredAt: occurredAt,
		})
	}
	if err := r.repo.Enqueue(ctx, entries); err != nil {
		return err
	}

	// Best-effort immediate delivery; the loop will retry anything left.
	for _, e := range entries {
		r.publishOne(ctx, e)
	}
	return nil
}

func (r *Relay) publishOne(ctx context.Context, e Entry) {
	if err := r.bus.PublishRaw(ctx, e.Payload); err != nil {
		r.log.WarnContext(ctx, "outbox publish failed; stays pending", "event_id", e.ID, "event", e.EventName, "error", err)
		if mErr := r.repo.MarkFailed(ctx, e.ID, err.Error()); mErr != nil {
			r.log.ErrorContext(ctx, "outbox mark failed", "event_id", e.ID, "error", mErr)
		}
		return
	}
	if err := r.repo.MarkPublished(ctx, e.ID); err != nil {
		r.log.ErrorContext(ctx, "outbox mark published", "event_id", e.ID, "error", err)
	}
}

// Run retries pending events until ctx is done — the recovery path for a broker
// that was down when the command was applied (§12.5).
func (r *Relay) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.drain(ctx)
		}
	}
}

// drain publishes up to a batch of pending events. Exposed for tests.
func (r *Relay) drain(ctx context.Context) {
	pending, err := r.repo.Pending(ctx, 100)
	if err != nil {
		r.log.ErrorContext(ctx, "outbox read pending", "error", err)
		return
	}
	for _, e := range pending {
		r.publishOne(ctx, e)
	}
}
