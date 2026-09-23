package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	domainlead "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/lead"
)

type LeadRepository struct {
	pool *pgxpool.Pool
}

func NewLeadRepository(pool *pgxpool.Pool) *LeadRepository {
	return &LeadRepository{pool: pool}
}

// Insert upserts by email -- ON CONFLICT DO NOTHING keeps a repeated
// submission (retry, double click) from erroring or creating a second
// row; either way the address is captured exactly once.
func (r *LeadRepository) Insert(ctx context.Context, l domainlead.Lead) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO leads (id, email, criado_em) VALUES ($1, $2, $3)
		 ON CONFLICT (email) DO NOTHING`,
		l.ID, l.Email, l.CriadoEm,
	)
	if err != nil {
		return fmt.Errorf("insert lead: %w", err)
	}
	return nil
}
