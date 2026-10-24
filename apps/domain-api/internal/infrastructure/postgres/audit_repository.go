package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditRepository is domain-api's read-only slice of the audit_log the
// worker writes unconditionally on every command, success or failure.
// Its one caller is the sync route (internal/infrastructure/http's
// SyncHandlers), which polls CommandOutcome until the row for its
// command lands — that write is the only proof the worker actually
// applied the write, since the RabbitMQ round-trip only ever promised
// "queued".
type AuditRepository struct {
	pool *pgxpool.Pool
}

func NewAuditRepository(pool *pgxpool.Pool) *AuditRepository {
	return &AuditRepository{pool: pool}
}

// CommandOutcome returns the processing outcome for commandID: found is
// false while the worker hasn't finished (or started) the command yet —
// that is the poll-again signal, not an error. On success, detail is
// the affected entity's id; on failure, the worker's own error text
// (the exact message the command's aggregate rejected it with).
func (r *AuditRepository) CommandOutcome(ctx context.Context, commandID string) (found, success bool, detail string, err error) {
	var entityID, errText string
	row := r.pool.QueryRow(ctx,
		`SELECT success, COALESCE(entity_id, ''), COALESCE(error, '')
		 FROM audit_log WHERE command_id = $1`, commandID)
	scanErr := row.Scan(&success, &entityID, &errText)
	if errors.Is(scanErr, pgx.ErrNoRows) {
		return false, false, "", nil
	}
	if scanErr != nil {
		return false, false, "", fmt.Errorf("audit outcome for %s: %w", commandID, scanErr)
	}
	if success {
		detail = entityID
	} else {
		detail = errText
	}
	return true, success, detail, nil
}