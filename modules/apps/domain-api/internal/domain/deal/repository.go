package deal

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of — domain-api only ever calls these.
type Repository interface {
	FindByKey(ctx context.Context, source, sourceDealID string) (Deal, error)
	// ListRecent is the feed read: newest first by when the deal was
	// first seen (posted_at), falling back to scraped_at, so deals
	// without a source timestamp still order sensibly.
	ListRecent(ctx context.Context, source string, limit int) ([]Deal, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "deal not found" }