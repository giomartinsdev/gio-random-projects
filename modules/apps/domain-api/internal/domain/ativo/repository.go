package ativo

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
type Repository interface {
	FindByID(ctx context.Context, id string) (Ativo, error)
	ListByUsuario(ctx context.Context, userEmail, contaID string) ([]Ativo, error)
	// ListAtivosComPosicao is cross-user -- the one read here not scoped
	// to a single person's session, for the proventos-worker's daily
	// sweep of every position that could still be owed a dividend.
	ListAtivosComPosicao(ctx context.Context) ([]Ativo, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "ativo not found" }
