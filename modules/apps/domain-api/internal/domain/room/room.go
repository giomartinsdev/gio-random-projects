// Package room is the domain layer for the Room aggregate as seen from
// domain-api: just enough to read, since this binary never writes --
// see internal/infrastructure/http's package doc.
package room

import "time"

type Room struct {
	ID          string
	HostID      string
	Title       string
	DocumentID  string
	// "book" (bookclub-api) or "class" (classroom-api) -- partitions
	// this one shared table between callers. See domain-worker's own
	// domain/room/room.go for the authoritative KindBook/KindClass
	// constants (this read-only copy doesn't redeclare them).
	Kind        string
	CurrentPage int
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
