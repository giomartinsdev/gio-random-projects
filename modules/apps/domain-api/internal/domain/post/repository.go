package post

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of — domain-api only ever calls these.
type Repository interface {
	FindByID(ctx context.Context, id string) (Post, error)
	FindBySlug(ctx context.Context, slug string) (Post, error)
	ListPublished(ctx context.Context) ([]Post, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "post not found" }
