package dashboardlayout

import "context"

// Repository is the read-only slice of the full port domain-worker
// implements the write side of -- domain-api only ever calls these.
type Repository interface {
	FindByUsuario(ctx context.Context, usuarioEmail string) (DashboardLayout, error)
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "dashboard layout not found" }
