package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	domaincchroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/cchroom"
)

// CCHRoomRepository implements domain/cchroom.Repository — read-only,
// matching what domain-api actually does with it: cch-api's boot load
// of its room registry. The write side lives in domain-worker.
type CCHRoomRepository struct {
	pool *pgxpool.Pool
}

func NewCCHRoomRepository(pool *pgxpool.Pool) *CCHRoomRepository {
	return &CCHRoomRepository{pool: pool}
}

func (r *CCHRoomRepository) List(ctx context.Context) ([]domaincchroom.Room, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, created_at, salt, hash, resume_key FROM cch_rooms ORDER BY created_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list cch rooms: %w", err)
	}
	defer rows.Close()

	var rooms []domaincchroom.Room
	for rows.Next() {
		var room domaincchroom.Room
		if err := rows.Scan(&room.ID, &room.CreatedAt, &room.Salt, &room.Hash, &room.ResumeKey); err != nil {
			return nil, fmt.Errorf("scan cch room: %w", err)
		}
		rooms = append(rooms, room)
	}
	return rooms, rows.Err()
}