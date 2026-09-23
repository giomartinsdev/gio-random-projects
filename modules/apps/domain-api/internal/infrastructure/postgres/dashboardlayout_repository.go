package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/dashboardlayout"
)

// DashboardLayoutRepository implements domain/dashboardlayout.Repository
// -- read-only, matching what domain-api actually does with it.
type DashboardLayoutRepository struct {
	pool *pgxpool.Pool
}

func NewDashboardLayoutRepository(pool *pgxpool.Pool) *DashboardLayoutRepository {
	return &DashboardLayoutRepository{pool: pool}
}

func (r *DashboardLayoutRepository) FindByUsuario(ctx context.Context, userEmail string) (domaindashboardlayout.DashboardLayout, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT user_email, blocos, updated_at FROM dashboard_layouts WHERE user_email = $1`,
		userEmail,
	)
	var l domaindashboardlayout.DashboardLayout
	err := row.Scan(&l.UserEmail, &l.Blocos, &l.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domaindashboardlayout.DashboardLayout{}, domaindashboardlayout.ErrNotFound
	}
	if err != nil {
		return domaindashboardlayout.DashboardLayout{}, fmt.Errorf("find dashboard layout: %w", err)
	}
	return l, nil
}
