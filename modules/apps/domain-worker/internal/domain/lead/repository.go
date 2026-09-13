package lead

import "context"

// Repository is a port -- domain-worker is the only implementer. There
// is no read side yet (no caller needs to list leads today); add one
// against this same interface when that changes, not a parallel path.
type Repository interface {
	// Insert upserts by email (ON CONFLICT DO NOTHING) -- the same
	// person submitting the landing page form twice is not two leads,
	// and Insert must stay idempotent for a browser retry to be safe.
	Insert(ctx context.Context, l Lead) error
}
