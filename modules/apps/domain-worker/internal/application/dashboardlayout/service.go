package dashboardlayout

import (
	"context"
	"time"

	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/dashboardlayout"
)

// Service is the use case: the only thing that calls
// domaindashboardlayout.Repository's write methods, so every mutation
// goes through the aggregate's own invariants (Save) -- same shape as
// application/cchdeck.Service (a single upsertable record keyed by an
// opaque caller-owned id, here usuario_email instead of a deck id).
type Service struct {
	repo domaindashboardlayout.Repository
}

func NewService(repo domaindashboardlayout.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Save(ctx context.Context, in SaveInput) (domaindashboardlayout.Event, error) {
	d, err := domaindashboardlayout.Save(in.UserEmail, in.Blocos)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Upsert(ctx, d); err != nil {
		return nil, err
	}
	return domaindashboardlayout.Saved{UserEmail: d.UserEmail, OccurredAt: d.UpdatedAt}, nil
}

func (s *Service) Delete(ctx context.Context, in DeleteInput) (domaindashboardlayout.Event, error) {
	if in.UserEmail == "" {
		return nil, domaindashboardlayout.ErrUsuarioRequired
	}
	if err := s.repo.Delete(ctx, in.UserEmail); err != nil {
		return nil, err
	}
	return domaindashboardlayout.Deleted{UserEmail: in.UserEmail, OccurredAt: time.Now().UTC()}, nil
}
