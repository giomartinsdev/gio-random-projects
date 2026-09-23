package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/dashboardlayout"
)

// DashboardLayoutRepository implements domain/dashboardlayout.Repository
// against Postgres -- the only adapter that satisfies that port.
type DashboardLayoutRepository struct {
	pool *pgxpool.Pool
}

func NewDashboardLayoutRepository(pool *pgxpool.Pool) *DashboardLayoutRepository {
	return &DashboardLayoutRepository{pool: pool}
}

func (r *DashboardLayoutRepository) FindByUsuario(ctx context.Context, usuarioEmail string) (domaindashboardlayout.DashboardLayout, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT usuario_email, blocos, atualizado_em FROM dashboard_layouts WHERE usuario_email = $1`, usuarioEmail)
	var d domaindashboardlayout.DashboardLayout
	err := row.Scan(&d.UsuarioEmail, &d.Blocos, &d.AtualizadoEm)
	if errors.Is(err, pgx.ErrNoRows) {
		return domaindashboardlayout.DashboardLayout{}, domaindashboardlayout.ErrNotFound
	}
	if err != nil {
		return domaindashboardlayout.DashboardLayout{}, fmt.Errorf("find dashboard layout: %w", err)
	}
	return d, nil
}

// Upsert replaces the whole record -- there's no partial-field update
// for a dashboard layout, the frontend always saves the complete
// blocos array, same treatment as cchdeck's Upsert.
func (r *DashboardLayoutRepository) Upsert(ctx context.Context, d domaindashboardlayout.DashboardLayout) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO dashboard_layouts (usuario_email, blocos, atualizado_em)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (usuario_email) DO UPDATE SET
		   blocos = EXCLUDED.blocos,
		   atualizado_em = EXCLUDED.atualizado_em`,
		d.UsuarioEmail, d.Blocos, d.AtualizadoEm,
	)
	if err != nil {
		return fmt.Errorf("upsert dashboard layout: %w", err)
	}
	return nil
}

func (r *DashboardLayoutRepository) Delete(ctx context.Context, usuarioEmail string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM dashboard_layouts WHERE usuario_email = $1`, usuarioEmail)
	if err != nil {
		return fmt.Errorf("delete dashboard layout: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domaindashboardlayout.ErrNotFound
	}
	return nil
}
