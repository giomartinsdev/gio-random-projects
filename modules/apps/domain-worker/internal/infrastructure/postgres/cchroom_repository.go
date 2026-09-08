package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	domaincchroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchroom"
)

// CCHRoomRepository implements domain/cchroom.Repository against
// Postgres — cch-api's room registry, written through the command
// pipeline instead of living in a JSON file on the container volume.
type CCHRoomRepository struct {
	pool *pgxpool.Pool
}

func NewCCHRoomRepository(pool *pgxpool.Pool) *CCHRoomRepository {
	return &CCHRoomRepository{pool: pool}
}

// Upsert writes the entry whole. ON CONFLICT DO UPDATE, not ON
// CONFLICT DO NOTHING: the caller treats a create as authoritative
// (a fresh room's salt/hash pair is THE password), so replaying a
// create must overwrite whatever stale bytes the row held — a re-fired
// import with older bytes must never leave a room unjoinable with its
// old password. It also makes a crashed cutover import simply converge.
func (r *CCHRoomRepository) Upsert(ctx context.Context, room domaincchroom.Room) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO cch_rooms (id, created_at, salt, hash, resume_key)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO UPDATE SET
		   created_at = EXCLUDED.created_at,
		   salt       = EXCLUDED.salt,
		   hash       = EXCLUDED.hash,
		   resume_key = EXCLUDED.resume_key`,
		room.ID, room.CreatedAt, room.Salt, room.Hash, room.ResumeKey,
	)
	if err != nil {
		return fmt.Errorf("upsert cch room: %w", err)
	}
	return nil
}

// Delete is a physical delete — a party-game room's lifetime is hours,
// there is nothing to soft-close, and the registry is the only thing
// that references the row. Deleting an already-gone id affects zero
// rows and that IS success: the janitor's sweep and an adm delete race
// each other by design, and both are supposed to come back ok.
func (r *CCHRoomRepository) Delete(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM cch_rooms WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete cch room: %w", err)
	}
	return nil
}