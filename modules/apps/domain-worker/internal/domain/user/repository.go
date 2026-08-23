package user

import "context"

// Repository is a port — domain-worker is the only implementer AND
// the only caller of the mutating methods (domain-api's own copy of
// this package only declares FindByID/List).
type Repository interface {
	FindByID(ctx context.Context, id string) (User, error)
	List(ctx context.Context) ([]User, error)
	Insert(ctx context.Context, u User) error
	Update(ctx context.Context, u User) error
	Delete(ctx context.Context, id string) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "user not found" }
