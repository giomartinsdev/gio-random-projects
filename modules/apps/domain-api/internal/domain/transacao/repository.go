package transacao

import (
	"context"
	"time"
)

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
type Repository interface {
	FindByID(ctx context.Context, id string) (Transacao, error)
	// ListByFiltro filters by usuarioEmail (required by the caller) and,
	// optionally, contaID/categoria (empty string = "any") and a
	// [de, ate] date range (nil = unbounded on that side).
	ListByFiltro(ctx context.Context, userEmail, contaID, categoria string, from_division, ate *time.Time) ([]Transacao, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "transacao not found" }
