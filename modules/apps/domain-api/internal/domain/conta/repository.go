package conta

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
type Repository interface {
	FindByID(ctx context.Context, id string) (Conta, error)
	ListByUsuario(ctx context.Context, userEmail, status string) ([]Conta, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "conta not found" }
