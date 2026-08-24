package post

import "context"

// Repository is a port — domain-worker is the only implementer AND
// the only caller of the mutating methods (domain-api's own copy of
// this package only declares the read methods it actually uses).
type Repository interface {
	FindByID(ctx context.Context, id string) (Post, error)
	FindBySlug(ctx context.Context, slug string) (Post, error)
	SlugExists(ctx context.Context, slug string) (bool, error)
	ListPublished(ctx context.Context) ([]Post, error)
	Insert(ctx context.Context, p Post) error
	Update(ctx context.Context, p Post) error
	Delete(ctx context.Context, id string) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "post not found" }
