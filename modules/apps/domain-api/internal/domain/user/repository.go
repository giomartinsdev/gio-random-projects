package user

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of — domain-api only ever calls
// FindByID/List.
type Repository interface {
	FindByID(ctx context.Context, id string) (User, error)
	List(ctx context.Context) ([]User, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "user not found" }
