package user

import "context"

// Repository is a port — the domain layer declares what it needs from
// storage, infrastructure/postgres provides it. Insert/Update are
// separate (not one Save) because the aggregate's own invariants
// already force a FindByID before any update, so a repository that
// silently upserts would let a caller skip that and create a user with
// a caller-chosen ID.
type Repository interface {
	FindByID(ctx context.Context, id string) (User, error)
	List(ctx context.Context) ([]User, error)
	Insert(ctx context.Context, u User) error
	Update(ctx context.Context, u User) error
	Delete(ctx context.Context, id string) error
}

// ErrNotFound is returned by FindByID/Update/Delete when the id doesn't
// exist — a domain-level concept (not a Postgres one), so callers above
// infrastructure/postgres never need to know it's really pgx.ErrNoRows
// under the hood.
var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "user not found" }
