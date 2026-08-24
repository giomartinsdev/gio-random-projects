package room

import "context"

// Repository is a port — domain-worker is the only implementer AND
// the only caller of the mutating methods (domain-api's own copy of
// this package only declares the read methods it actually uses).
type Repository interface {
	FindByID(ctx context.Context, id string) (Room, error)
	ListAll(ctx context.Context) ([]Room, error)
	Insert(ctx context.Context, r Room) error
	Update(ctx context.Context, r Room) error
	Delete(ctx context.Context, id string) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "room not found" }
