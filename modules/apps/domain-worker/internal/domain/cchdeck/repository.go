package cchdeck

import "context"

// Repository is the storage port for marketplace entries. domain-worker
// is the only implementer and the only caller — domain-api's copy of
// this aggregate carries the read side instead (List, for cch-api's
// boot load). Upsert, not Insert: publishing and the plays bump are
// the same write (the whole record, keyed by id), and a re-fired
// command must land on its row, not error against it.
type Repository interface {
	Upsert(ctx context.Context, deck Deck) error
	// IncrementPlays bumps the play count in place (plays = plays + 1)
	// rather than through a whole-record upsert: the bump travels the
	// async path, so it can race a publish or another bump, and a
	// read-modify-write over the whole row would drop whichever side
	// landed second. Returns the new count.
	IncrementPlays(ctx context.Context, id string) (int, error)
}