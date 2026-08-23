package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/api/internal/domain/user"
)

// UserRepository implements domain/user.Repository — read-only,
// matching what domain-api actually does with it.
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
