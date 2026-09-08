package cchdeck

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
// List backs cch-api's boot load (and its one-time cutover import's
// "is the table empty" check); the marketplace is capped at a few
// hundred decks by the caller's own maxDecks.
type Repository interface {
	List(ctx context.Context) ([]Deck, error)
}