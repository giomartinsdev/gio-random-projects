// Package outbox is the domain-worker's durable publish record (§4.3):
// one row per domain event that must reach the broker, written before the
// publish attempt so a broker outage cannot lose an event that was already
// applied. A relay reads the pending rows and publishes them, at-least-once;
// consumers are idempotent by event_id (§12.5).
//
// It is deliberately aggregate-agnostic: the worker publishes events of every
// bounded context through the same relay, so this port carries the wire
// envelope (name + JSON payload) rather than any one aggregate's type.
package outbox

import (
	"context"
	"encoding/json"
	"time"
)

// Entry is one event waiting to be published.
type Entry struct {
	// ID is the stable event id. Unique, so a re-enqueue of the same logical
	// event is a no-op (the at-least-once duplicate the consumer swallows).
	ID         string
	EventName  string
	Payload    json.RawMessage
	OccurredAt time.Time
}

// Repository is the port; infrastructure/postgres provides the only adapter.
type Repository interface {
	// Enqueue persists the entries as pending. Idempotent by ID.
	Enqueue(ctx context.Context, entries []Entry) error
	// Pending returns up to limit unpublished entries, oldest first.
	Pending(ctx context.Context, limit int) ([]Entry, error)
	// MarkPublished records that an entry reached the broker.
	MarkPublished(ctx context.Context, id string) error
	// MarkFailed records a publish attempt that failed, with the reason.
	MarkFailed(ctx context.Context, id, reason string) error
}
