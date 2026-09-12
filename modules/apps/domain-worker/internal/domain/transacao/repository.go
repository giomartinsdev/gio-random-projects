package transacao

import (
	"context"
	"time"
)

// Repository is a port — domain-worker is the only implementer AND the
// only caller of the mutating methods. Unlike conta, Delete here is a
// physical DELETE: a transacao has no "arquivar" concept, and FR-021
// allows removing one outright.
type Repository interface {
	FindByID(ctx context.Context, id string) (Transacao, error)
	ListByFiltro(ctx context.Context, usuarioEmail, contaID, categoria string, de, ate *time.Time) ([]Transacao, error)
	Insert(ctx context.Context, t Transacao) error
	Update(ctx context.Context, t Transacao) error
	Delete(ctx context.Context, id string) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "transacao not found" }
