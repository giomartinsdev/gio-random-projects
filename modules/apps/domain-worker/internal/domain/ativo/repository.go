package ativo

import (
	"context"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativomovimento"
)

// Repository is a port — domain-worker is the only implementer AND the
// only caller of the mutating methods. Insert and InsertMovimento each
// write an Ativo row alongside an ativomovimento row inside one SQL
// transaction (see postgres.AtivoRepository) since neither is a
// complete, consistent state on its own.
type Repository interface {
	FindByID(ctx context.Context, id string) (Ativo, error)
	ListByUsuario(ctx context.Context, userEmail, contaID string) ([]Ativo, error)
	Insert(ctx context.Context, a Ativo, primeiroMovimento ativomovimento.AtivoMovimento) error
	InsertMovimento(ctx context.Context, a Ativo, mov ativomovimento.AtivoMovimento) error
	UpdateCotacao(ctx context.Context, ativoID string, cotacao float64, obtidaEm time.Time) error
	ListMovimentos(ctx context.Context, ativoID string) ([]ativomovimento.AtivoMovimento, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "ativo not found" }
