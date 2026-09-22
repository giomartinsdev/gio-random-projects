package club

import "context"

// Repository is a port — domain-worker is the only implementer AND the
// only caller of the mutating methods. There is no Delete: a club we have
// ever seen stays known, it only stops being atualizado when it leaves
// every watchlist.
type Repository interface {
	FindByID(ctx context.Context, clubID string) (Club, error)
	ListAcompanhados(ctx context.Context) ([]Club, error)
	// Upsert writes the whole club, inserting on first sight and updating
	// afterwards. The ingest calls this every cycle for every club it
	// tracks, so it must be idempotent by ClubID.
	Upsert(ctx context.Context, c Club) error
	// SetAcompanhado flips the flag once the ingest has successfully
	// fetched squad and matches for a club.
	SetAcompanhado(ctx context.Context, clubID string, acompanhado bool) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "club not found" }
