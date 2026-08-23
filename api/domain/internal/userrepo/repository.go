// Package userrepo is the only place that touches the users table.
// domain-api uses it read-only (GET); domain-worker is the only writer,
// applying commands after they come off the queue.
package userrepo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/models"
)

var ErrNotFound = errors.New("user not found")

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) List(ctx context.Context) ([]models.User, error) {
	rows, err := r.pool.Query(ctx, `SELECT id, name, email, created_at, updated_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func (r *Repository) Get(ctx context.Context, id string) (models.User, error) {
	var u models.User
	err := r.pool.QueryRow(ctx,
		`SELECT id, name, email, created_at, updated_at FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.User{}, ErrNotFound
	}
	if err != nil {
		return models.User{}, fmt.Errorf("get user: %w", err)
	}
	return u, nil
}

func (r *Repository) Create(ctx context.Context, id string, input models.UserInput) (models.User, error) {
	var u models.User
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (id, name, email) VALUES ($1, $2, $3)
		 RETURNING id, name, email, created_at, updated_at`,
		id, input.Name, input.Email,
	).Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return models.User{}, fmt.Errorf("create user: %w", err)
	}
	return u, nil
}

func (r *Repository) Update(ctx context.Context, id string, input models.UserInput) (models.User, error) {
	var u models.User
	err := r.pool.QueryRow(ctx,
		`UPDATE users SET name = $2, email = $3, updated_at = now()
		 WHERE id = $1
		 RETURNING id, name, email, created_at, updated_at`,
		id, input.Name, input.Email,
	).Scan(&u.ID, &u.Name, &u.Email, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.User{}, ErrNotFound
	}
	if err != nil {
		return models.User{}, fmt.Errorf("update user: %w", err)
	}
	return u, nil
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
