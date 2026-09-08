package rooms

import (
	"context"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/domainapi"
)

// DomainPersister keeps the registry in domain-api's cch_rooms table
// (written by domain-worker through the command pipeline). Each Save
// is a synchronous round-trip through POST /sync — the confirmation
// that the row is in Postgres before "sala criada" is answered is the
// whole reason the sync route exists; deletes go the same way so a
// deleted room can't resurrect on the next boot load.
type DomainPersister struct {
	c *domainapi.Client
}

// NewDomainPersister wires the registry to domain-api.
func NewDomainPersister(c *domainapi.Client) *DomainPersister {
	return &DomainPersister{c: c}
}

func (p *DomainPersister) Load(ctx context.Context) ([]StoredRoom, error) {
	rooms, err := p.c.ListRooms(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]StoredRoom, 0, len(rooms))
	for _, room := range rooms {
		out = append(out, StoredRoom{
			ID:        room.ID,
			CreatedAt: room.CreatedAt,
			Salt:      room.Salt,
			Hash:      room.Hash,
			ResumeKey: room.ResumeKey,
		})
	}
	return out, nil
}

func (p *DomainPersister) Save(ctx context.Context, room StoredRoom) error {
	// The salt/hash/resume-key trio is always non-empty by construction
	// (Create mints all three before persisting), so the worker's
	// validation can only reject this on an internal mistake — which is
	// exactly what we want surfaced as an error rather than a silent
	// memory-only room.
	if _, err := p.c.Sync(ctx, "cchroom.create", domainapi.RoomInput{
		ID:        room.ID,
		CreatedAt: room.CreatedAt,
		Salt:      room.Salt,
		Hash:      room.Hash,
		ResumeKey: room.ResumeKey,
	}); err != nil {
		return fmt.Errorf("persist room %s: %w", room.ID, err)
	}
	return nil
}

func (p *DomainPersister) Delete(ctx context.Context, id string) error {
	if _, err := p.c.Sync(ctx, "cchroom.delete", domainapi.DeleteInput{ID: id}); err != nil {
		return fmt.Errorf("delete room %s: %w", id, err)
	}
	return nil
}