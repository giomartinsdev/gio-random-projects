package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/outbox"
)

// OutboxRepository implements application/outbox.Repository against Postgres.
type OutboxRepository struct {
	pool *pgxpool.Pool
}

func NewOutboxRepository(pool *pgxpool.Pool) *OutboxRepository {
	return &OutboxRepository{pool: pool}
}

// Enqueue persists the entries as pending, idempotent by id: a re-enqueue of
// the same logical event (same deterministic id) is a no-op.
func (r *OutboxRepository) Enqueue(ctx context.Context, entries []outbox.Entry) error {
	for _, e := range entries {
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO outbox (id, event_name, payload, occurred_at)
			VALUES ($1, $2, $3::jsonb, $4)
			ON CONFLICT (id) DO NOTHING`,
			e.ID, e.EventName, string(e.Payload), e.OccurredAt); err != nil {
			return fmt.Errorf("enqueue event %s: %w", e.EventName, err)
		}
	}
	return nil
}

func (r *OutboxRepository) Pending(ctx context.Context, limit int) ([]outbox.Entry, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, event_name, payload, occurred_at
		FROM outbox
		WHERE published_at IS NULL
		ORDER BY created_at ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("read pending outbox: %w", err)
	}
	defer rows.Close()

	out := make([]outbox.Entry, 0)
	for rows.Next() {
		var (
			e       outbox.Entry
			payload []byte
		)
		if err := rows.Scan(&e.ID, &e.EventName, &payload, &e.OccurredAt); err != nil {
			return nil, fmt.Errorf("scan outbox row: %w", err)
		}
		e.Payload = json.RawMessage(payload)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *OutboxRepository) MarkPublished(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `UPDATE outbox SET published_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("mark published: %w", err)
	}
	return nil
}

func (r *OutboxRepository) MarkFailed(ctx context.Context, id, reason string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, id, reason)
	if err != nil {
		return fmt.Errorf("mark failed: %w", err)
	}
	return nil
}
