package clubesnapshot

import (
	"context"
	"time"
)

// Repository is a port. Append is the only write: a snapshot is never
// updated, which is what makes the series trustworthy.
type Repository interface {
	// Append writes the reading and returns the division change it
	// produced (nil when the division did not move), diffing against the
	// most recent previous reading for that club.
	Append(ctx context.Context, s Snapshot) (*MudancaDivisao, error)
	// Latest returns the most recent reading for a club, or ErrNotFound.
	Latest(ctx context.Context, clubID string) (Snapshot, error)
	// Series returns every reading for a club, oldest first — the shape a
	// line chart consumes directly.
	Series(ctx context.Context, clubID string, since time.Time) ([]Snapshot, error)
	// Changes returns the dated division changes for a club, newest first.
	Changes(ctx context.Context, clubID string) ([]MudancaDivisao, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "snapshot not found" }

// IngestEstado é a saúde do worker. Não pertence a um clube, mas a este
// agregado por proximidade -- é o snapshot do próprio coletor.
type IngestEstado struct {
	Cycles        int
	ClubesOK       int
	ClubsFailed   int
	NewMatches  int
	Snapshots      int
	Bootstrapped bool
	LastError     string
}
