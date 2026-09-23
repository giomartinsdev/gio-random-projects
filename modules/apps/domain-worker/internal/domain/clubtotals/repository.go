package clubetotais

import "context"

// Repository is a port — one upsertable row per club, keyed by ClubID.
type Repository interface {
	Upsert(ctx context.Context, t Totais) error
	FindByClub(ctx context.Context, clubID string) (Totais, error)
	// UpsertMany writes a whole page in one transaction — the search
	// endpoint returns every matching club at once, and one round-trip
	// per club would make a broad search needlessly slow.
	UpsertMany(ctx context.Context, list []Totais) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "clube totais not found" }
