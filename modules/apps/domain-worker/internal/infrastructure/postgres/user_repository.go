package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/user"
)

// UserRepository implements domain/user.Repository against Postgres —
// the only adapter that satisfies that port.
type UserRepository struct {
	pool *pgxpool.Pool
}

func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
	return &UserRepository{pool: pool}
}

func (r *UserRepository) List(ctx context.Context) ([]domainuser.User, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, name, email, created_at, updated_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []domainuser.User
	for rows.Next() {
		var u domainuser.User
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (r *UserRepository) FindByID(ctx context.Context, id string) (domainuser.User, error) {
	var u domainuser.User
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, email, created_at, updated_at FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainuser.User{}, domainuser.ErrNotFound
	}
	if err != nil {
		return domainuser.User{}, fmt.Errorf("find user: %w", err)
	}
	return u, nil
}

func (r *UserRepository) Insert(ctx context.Context, u domainuser.User) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users (id, name, email, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
		u.ID, u.Name, u.Email, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}
	return nil
}

func (r *UserRepository) Update(ctx context.Context, u domainuser.User) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE users SET name = $2, email = $3, updated_at = $4 WHERE id = $1`,
		u.ID, u.Name, u.Email, u.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("update user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainuser.ErrNotFound
	}
	return nil
}

func (r *UserRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainuser.ErrNotFound
	}
	return nil
}
