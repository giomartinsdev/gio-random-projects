package ativomovimento

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
type Repository interface {
	ListByAtivo(ctx context.Context, ativoID string) ([]AtivoMovimento, error)
}
