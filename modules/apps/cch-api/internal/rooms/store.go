package rooms

import (
	"context"
	"log"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/game"
)

// Rooms survive a restart of this process, so a deploy doesn't throw
// everyone out of a session that's in progress. Only the room itself
// is persisted -- code, password hash and resume key. Who is connected
// is deliberately NOT persisted: those are live WebSockets that die
// with the process anyway, and every client reconnects and
// re-announces itself (see the client's useGame). The game in progress
// (round, hands, scores) is likewise not persisted: a restart puts
// every room back in the lobby, which is acceptable for a party game.
//
// The durable home is whatever Persister the process was built with --
// domain-api's cch_rooms table in production (see persist_domain.go),
// nothing at all in dev and tests. Restores go through the same
// interface, so this file neither knows nor cares that Postgres
// exists.
//
// A restored room comes back empty, which starts its normal
// empty-room grace period -- long enough for everyone to reconnect,
// short enough that a room nobody returns to still gets collected.
type StoredRoom struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	Salt      []byte    `json:"salt"`
	Hash      []byte    `json:"hash"`
	ResumeKey []byte    `json:"resumeKey"`
}

// Persister is the registry's durable slice: load everything at boot,
// save one room on create, drop one on delete/sweep. Per-room calls,
// not a whole-registry rewrite -- with the old JSON file that choice
// was arbitrary (rewriting a few hundred bytes was free); with
// domain-api it's the difference between one small command and a
// thundering herd of them.
//
// Implementations are allowed to be slow (each Save is a synchronous
// HTTP round-trip through the /sync route), which is exactly why every
// call in this package happens with the registry lock RELEASED -- the
// b433528 deadlock contract.
type Persister interface {
	Load(ctx context.Context) ([]StoredRoom, error)
	Save(ctx context.Context, room StoredRoom) error
	Delete(ctx context.Context, id string) error
}

// Load pulls every stored room in. An empty result is not an error:
// that's the first boot, or a fresh table.
func (r *Registry) Load() error {
	if r.persist == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	stored, err := r.persist.Load(ctx)
	if err != nil {
		return err
	}

	now := r.now()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range stored {
		if now.Sub(p.CreatedAt) > maxRoomAge {
			continue // would be swept immediately anyway
		}
		r.rooms[p.ID] = &Room{
			ID:        p.ID,
			CreatedAt: p.CreatedAt,
			salt:      p.Salt,
			hash:      p.Hash,
			resumeKey: p.ResumeKey,
			peers:     make(map[string]*Peer),
			knocks:    make(map[string]*Knock),
			game:      game.New(),
			emptyAt:   now,
			lastSeen:  now,
		}
	}
	return nil
}

// persistOne writes a single room's durable row. Persist errors are
// logged and swallowed: the room already exists in memory and works,
// it just may not survive a restart -- the same degradation the old
// file store had when a write failed.
//
// Caller must NOT hold r.mu (see Persister's doc comment).
func (r *Registry) persistOne(room StoredRoom) {
	if r.persist == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := r.persist.Save(ctx, room); err != nil {
		log.Printf("[cch] sala %s não persistida: %v", room.ID, err)
	}
}

// deletePersisted drops a room's durable row. Idempotent by contract:
// deleting a row that's already gone is success, so a sweep and an
// explicit delete can race without either failing.
//
// Caller must NOT hold r.mu.
func (r *Registry) deletePersisted(id string) {
	if r.persist == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := r.persist.Delete(ctx, id); err != nil {
		log.Printf("[cch] remoção da sala %s não persistida: %v", id, err)
	}
}