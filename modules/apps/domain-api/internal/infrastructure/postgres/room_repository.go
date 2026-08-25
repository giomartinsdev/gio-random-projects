package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/room"
)

// RoomRepository implements domain/room.Repository -- read-only,
// matching what domain-api actually does with it.
type RoomRepository struct {
	pool *pgxpool.Pool
}

func NewRoomRepository(pool *pgxpool.Pool) *RoomRepository {
	return &RoomRepository{pool: pool}
}

const roomColumns = `id, host_id, title, document_id, kind, current_page, status, created_at, updated_at`

func scanRoom(row pgx.Row) (domainroom.Room, error) {
	var r domainroom.Room
	err := row.Scan(&r.ID, &r.HostID, &r.Title, &r.DocumentID, &r.Kind, &r.CurrentPage, &r.Status, &r.CreatedAt, &r.UpdatedAt)
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
