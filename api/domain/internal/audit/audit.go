// Package audit is domain-worker's only writer to audit_log — every
// command it processes gets a row here, success or failure, so the
// audit trail reflects what was attempted, not just what stuck.
package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

type Entry struct {
	CommandID  string
	EntityType string
	EntityID   string
	Action     string
	Payload    any
	Success    bool
	Error      string
}

func (r *Repository) Record(ctx context.Context, e Entry) error {
	var payload []byte
	if e.Payload != nil {
		var err error
		payload, err = json.Marshal(e.Payload)
		if err != nil {
			return fmt.Errorf("marshal audit payload: %w", err)
		}
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO audit_log (id, command_id, entity_type, entity_id, action, payload, success, error)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		uuid.NewString(), e.CommandID, e.EntityType, nullableString(e.EntityID), e.Action, payload, e.Success, nullableString(e.Error),
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
