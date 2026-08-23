package postgres

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/audit"
)

// AuditRepository implements application/audit.Repository against
// Postgres — the only adapter that satisfies that port.
type AuditRepository struct {
	pool *pgxpool.Pool
}

func NewAuditRepository(pool *pgxpool.Pool) *AuditRepository {
	return &AuditRepository{pool: pool}
}

func (r *AuditRepository) Record(ctx context.Context, e audit.Entry) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO audit_log (id, command_id, entity_type, entity_id, action, payload, success, error)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		uuid.NewString(), e.CommandID, e.EntityType, nullableString(e.EntityID), e.Action, e.Payload, e.Success, nullableString(e.Error),
	)
	if err != nil {
		return fmt.Errorf("insert audit entry: %w", err)
	}
	return nil
}

func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
