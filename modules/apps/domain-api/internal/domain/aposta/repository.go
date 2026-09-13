package aposta

import "context"

type Repository interface {
	FindByID(ctx context.Context, id string) (Aposta, error)
	ListByUsuario(ctx context.Context, usuarioEmail, contaID string) ([]Aposta, error)
	// ListPendentes is the one cross-user read on this aggregate -- the
	// resolver worker's daily sweep has no session to scope by, same
	// reasoning as domain/ativo's ListAtivosComPosicao.
	ListPendentes(ctx context.Context) ([]Aposta, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "aposta not found" }
