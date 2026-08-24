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
	CurrentPage int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
