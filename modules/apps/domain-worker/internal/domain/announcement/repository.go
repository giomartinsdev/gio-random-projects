package anuncio

import (
	"context"
	"time"
)

// Repository is a port. Append-only and trimmed by age — an announcement is
// a fact about a moment, never edited.
type Repository interface {
	Append(ctx context.Context, a Anuncio) error
	// Recent returns the newest N unexpired announcements, newest first.
	Recent(ctx context.Context, limit int) ([]Anuncio, error)
	// TrimOlderThan drops announcements past their expiry — called by the
	// ingest so the feed never grows unbounded.
	TrimOlderThan(ctx context.Context, cutoff time.Time) (int, error)
}
