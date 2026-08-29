package post

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of — domain-api only ever calls these.
type Repository interface {
	FindByID(ctx context.Context, id string) (Post, error)
	FindBySlug(ctx context.Context, slug string) (Post, error)
	ListPublished(ctx context.Context) ([]Post, error)
	// ListByAuthor returns ALL of the author's posts — published AND
	// drafts. It's a trusted-caller read (API key required like every
	// route here): post-api decides per-request whether the caller may
	// see the drafts, this layer never filters by status itself.
	ListByAuthor(ctx context.Context, authorID string) ([]Post, error)
	// SearchPublished is ListPublished narrowed by a plain substring
	// match on title/body/excerpt (ILIKE, not tsvector — the corpus is
	// community-blog sized and "find a post I half-remember" doesn't
	// need ranking yet).
	SearchPublished(ctx context.Context, query string) ([]Post, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "post not found" }
