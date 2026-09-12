package ativo

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
type Repository interface {
	FindByID(ctx context.Context, id string) (Ativo, error)
	ListByUsuario(ctx context.Context, usuarioEmail, contaID string) ([]Ativo, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "ativo not found" }
