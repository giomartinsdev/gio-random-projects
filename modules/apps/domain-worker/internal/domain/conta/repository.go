package conta

import "context"

// Repository is a port — domain-worker is the only implementer AND the
// only caller of the mutating methods. There is no Delete: arquivar a
// conta is a Status update via Edit/Update, not a physical deletion --
// a conta's transacoes and ativos would otherwise dangle.
type Repository interface {
	FindByID(ctx context.Context, id string) (Conta, error)
	ListByUsuario(ctx context.Context, userEmail, status string) ([]Conta, error)
	Insert(ctx context.Context, c Conta) error
	Update(ctx context.Context, c Conta) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "conta not found" }
