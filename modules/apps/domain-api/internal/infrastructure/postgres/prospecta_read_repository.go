package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/prospecta"
)

// ProspectaReadRepository implements domain/prospecta.ReadRepository against
// Postgres. Read-only: as tabelas prospecta_* são escritas só pelo
// domain-worker. Multi-tenant com RLS — a sessão fixa app.current_tenant na
// transação, como o repositório do worker.
type ProspectaReadRepository struct {
	pool *pgxpool.Pool
}

func NewProspectaReadRepository(pool *pgxpool.Pool) *ProspectaReadRepository {
	return &ProspectaReadRepository{pool: pool}
}

func (r *ProspectaReadRepository) withTenant(ctx context.Context, tenantID string, fn func(pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin prospecta read tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('app.current_tenant', $1, true)`, tenantID); err != nil {
		return fmt.Errorf("set prospecta read tenant: %w", err)
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *ProspectaReadRepository) GetCompany(ctx context.Context, tenantID, id string) (domainprospecta.CompanyView, error) {
	var v domainprospecta.CompanyView
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var created time.Time
		// O WHERE filtra o tenant além do RLS (defesa em profundidade: a role
		// pode ser owner/BYPASSRLS).
		err := tx.QueryRow(ctx, `
			SELECT id::text, tenant_id::text, name, site, description, created_at
			  FROM prospecta_company WHERE id = $1 AND tenant_id = $2`, id, tenantID).
			Scan(&v.ID, &v.TenantID, &v.Name, &v.Site, &v.Description, &created)
		if err != nil {
			return err
		}
		v.CreatedAt = created.UTC().Format(time.RFC3339)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.CompanyView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.CompanyView{}, err
	}
	// O ICP é opcional: uma empresa recém-cadastrada ainda não o definiu.
	icp, err := r.ICPByCompany(ctx, tenantID, id)
	if err == nil {
		v.ICP = &icp
	} else if !errors.Is(err, domainprospecta.ErrNotFound) {
		return domainprospecta.CompanyView{}, err
	}
	return v, nil
}

func (r *ProspectaReadRepository) ICPByCompany(ctx context.Context, tenantID, companyID string) (domainprospecta.ICPView, error) {
	var v domainprospecta.ICPView
	var created time.Time
	err := r.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT id::text, company_id::text, definition, signals, created_at
			  FROM prospecta_icp WHERE company_id = $1 AND tenant_id = $2
			  ORDER BY created_at DESC LIMIT 1`, companyID, tenantID).
			Scan(&v.ID, &v.CompanyID, &v.Definition, &v.Signals, &created)
		if err != nil {
			return err
		}
		v.CreatedAt = created.UTC().Format(time.RFC3339)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domainprospecta.ICPView{}, domainprospecta.ErrNotFound
	}
	if err != nil {
		return domainprospecta.ICPView{}, err
	}
	if v.Signals == nil {
		v.Signals = []string{}
	}
	return v, nil
}
