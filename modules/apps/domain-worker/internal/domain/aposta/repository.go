package aposta

import "context"

// Repository is a port -- domain-worker is the only implementer AND the
// only caller of the mutating methods. Unlike Ativo/AtivoMovimento,
// Aposta is a single row with no child records, so Insert/Update are
// plain single-table writes.
type Repository interface {
	FindByID(ctx context.Context, id string) (Aposta, error)
	ListByUsuario(ctx context.Context, userEmail, contaID string) ([]Aposta, error)
	Insert(ctx context.Context, a Aposta) error
	Update(ctx context.Context, a Aposta) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "aposta not found" }
