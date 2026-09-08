package cchroom

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
// List backs cch-api's boot load: the whole registry at once (capped
// at a few hundred entries by the caller's own maxRooms) is exactly
// what its restart needs, so there is no pagination to grow into.
type Repository interface {
	List(ctx context.Context) ([]Room, error)
}