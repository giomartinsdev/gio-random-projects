package deal

import "context"

// Repository is a port — domain-worker is the only implementer of the
// mutating method, and the only caller (domain-api's own copy of this
// package only declares the read methods it actually uses).
type Repository interface {
	// Upsert writes the deal and reports whether this was a new row —
	// "inserted" is what separates news from a re-poll of the same
	// deal, and it comes back from Postgres itself (xmax trick), not
	// from a read-before-write the caller would have to race around.
	Upsert(ctx context.Context, d Deal) (inserted bool, err error)
}
