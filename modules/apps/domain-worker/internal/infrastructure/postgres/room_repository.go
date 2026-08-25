package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/room"
)

// RoomRepository implements domain/room.Repository against Postgres --
// the only adapter that satisfies that port.
type RoomRepository struct {
	pool *pgxpool.Pool
}

func NewRoomRepository(pool *pgxpool.Pool) *RoomRepository {
	return &RoomRepository{pool: pool}
}

const roomColumns = `id, host_id, title, document_id, current_page, status, created_at, updated_at`

func scanRoom(row pgx.Row) (domainroom.Room, error) {
	var r domainroom.Room
	err := row.Scan(&r.ID, &r.HostID, &r.Title, &r.DocumentID, &r.CurrentPage, &r.Status, &r.CreatedAt, &r.UpdatedAt)
	return r, err
}

func (r *RoomRepository) FindByID(ctx context.Context, id string) (domainroom.Room, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+roomColumns+` FROM rooms WHERE id = $1`, id)
	room, err := scanRoom(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainroom.Room{}, domainroom.ErrNotFound
	}
	if err != nil {
		return domainroom.Room{}, fmt.Errorf("find room: %w", err)
	}
	return room, nil
}

func (r *RoomRepository) ListAll(ctx context.Context) ([]domainroom.Room, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+roomColumns+` FROM rooms ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list rooms: %w", err)
	}
	defer rows.Close()

	var rooms []domainroom.Room
	for rows.Next() {
		room, err := scanRoom(rows)
		if err != nil {
			return nil, fmt.Errorf("scan room: %w", err)
		}
		rooms = append(rooms, room)
	}
	return rooms, rows.Err()
}

func (r *RoomRepository) Insert(ctx context.Context, room domainroom.Room) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO rooms (id, host_id, title, document_id, current_page, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		room.ID, room.HostID, room.Title, room.DocumentID, room.CurrentPage, room.Status, room.CreatedAt, room.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert room: %w", err)
	}
	return nil
}

func (r *RoomRepository) Update(ctx context.Context, room domainroom.Room) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE rooms SET title = $2, current_page = $3, status = $4, updated_at = $5 WHERE id = $1`,
		room.ID, room.Title, room.CurrentPage, room.Status, room.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("update room: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainroom.ErrNotFound
	}
	return nil
}

// Soft close only -- "Encerrar sala" flips status to
// domainroom.StatusClosed instead of physically deleting the row.
// The room and every message in it stay in Postgres forever; a closed
// room just stops being joinable/playable (bookclub-api enforces
// that, this layer only records the state). Excludes already-closed
// rooms so this stays idempotent-safe the same way the other writers
// guard against double-application.
func (r *RoomRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE rooms SET status = $2, updated_at = now() WHERE id = $1 AND status != $2`,
		id, domainroom.StatusClosed,
	)
	if err != nil {
		return fmt.Errorf("close room: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainroom.ErrNotFound
	}
	return nil
}
