package dashboardlayout

import "context"

// Repository is a port — domain-worker is the only implementer AND the
// only caller of the mutating methods.
type Repository interface {
	FindByUsuario(ctx context.Context, userEmail string) (DashboardLayout, error)
	Upsert(ctx context.Context, d DashboardLayout) error
	Delete(ctx context.Context, userEmail string) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "dashboard layout not found" }
