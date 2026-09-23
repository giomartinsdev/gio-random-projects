package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/conta"
)

// ContaRepository implements domain/conta.Repository -- read-only,
// matching what domain-api actually does with it.
type ContaRepository struct {
	pool *pgxpool.Pool
}

func NewContaRepository(pool *pgxpool.Pool) *ContaRepository {
	return &ContaRepository{pool: pool}
}

const contaColumns = `id, user_email, name, kind, status, created_at, updated_at`

func scanConta(row pgx.Row) (domainconta.Conta, error) {
	var c domainconta.Conta
	err := row.Scan(&c.ID, &c.UserEmail, &c.Name, &c.Kind, &c.Status, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

func (r *ContaRepository) FindByID(ctx context.Context, id string) (domainconta.Conta, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+contaColumns+` FROM contas WHERE id = $1`, id)
	c, err := scanConta(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainconta.Conta{}, domainconta.ErrNotFound
	}
	if err != nil {
		return domainconta.Conta{}, fmt.Errorf("find conta: %w", err)
	}
	return c, nil
}

// An empty status means "any status" -- the filter collapses out rather
// than needing a second query string.
func (r *ContaRepository) ListByUsuario(ctx context.Context, userEmail, status string) ([]domainconta.Conta, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+contaColumns+` FROM contas
		 WHERE user_email = $1 AND ($2 = '' OR status = $2)
		 ORDER BY created_at DESC`,
		userEmail, status,
	)
	if err != nil {
		return nil, fmt.Errorf("list contas: %w", err)
	}
	defer rows.Close()

	var contas []domainconta.Conta
	for rows.Next() {
		c, err := scanConta(rows)
		if err != nil {
			return nil, fmt.Errorf("scan conta: %w", err)
		}
		contas = append(contas, c)
	}
	return contas, rows.Err()
}
