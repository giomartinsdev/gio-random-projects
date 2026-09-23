package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/conta"
)

// ContaRepository implements domain/conta.Repository against Postgres --
// the only adapter that satisfies that port.
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

// ListByUsuario returns every conta the usuario owns, optionally
// filtered by status -- an empty status means "todas" (both ativa and
// arquivada), same "empty = no filter" convention the rest of this
// package uses.
func (r *ContaRepository) ListByUsuario(ctx context.Context, userEmail, status string) ([]domainconta.Conta, error) {
	var rows pgx.Rows
	var err error
	if status == "" {
		rows, err = r.pool.Query(ctx,
			`SELECT `+contaColumns+` FROM contas WHERE user_email = $1 ORDER BY created_at DESC`, userEmail)
	} else {
		rows, err = r.pool.Query(ctx,
			`SELECT `+contaColumns+` FROM contas WHERE user_email = $1 AND status = $2 ORDER BY created_at DESC`,
			userEmail, status)
	}
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

func (r *ContaRepository) Insert(ctx context.Context, c domainconta.Conta) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO contas (id, user_email, name, kind, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		c.ID, c.UserEmail, c.Name, c.Kind, c.Status, c.CreatedAt, c.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert conta: %w", err)
	}
	return nil
}

func (r *ContaRepository) Update(ctx context.Context, c domainconta.Conta) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE contas SET name = $2, status = $3, updated_at = $4 WHERE id = $1`,
		c.ID, c.Name, c.Status, c.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("update conta: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainconta.ErrNotFound
	}
	return nil
}
