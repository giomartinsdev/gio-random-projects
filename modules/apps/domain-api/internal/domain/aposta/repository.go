package aposta

import "context"

type Repository interface {
	FindByID(ctx context.Context, id string) (Aposta, error)
	ListByUsuario(ctx context.Context, usuarioEmail, contaID string) ([]Aposta, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "aposta not found" }
