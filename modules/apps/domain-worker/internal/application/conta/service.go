package conta

import (
	"context"

	domainconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/conta"
)

// Service is the use case: the only thing that calls
// domainconta.Repository's write methods, so every mutation goes
// through the aggregate's own invariants (New/Edit) -- same shape as
// application/room.Service.
type Service struct {
	repo domainconta.Repository
}

func NewService(repo domainconta.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, id string, in CreateInput) (domainconta.Conta, domainconta.Event, error) {
	c, err := domainconta.New(id, in.UserEmail, in.Name, in.Kind)
	if err != nil {
		return domainconta.Conta{}, nil, err
	}
	if err := s.repo.Insert(ctx, c); err != nil {
		return domainconta.Conta{}, nil, err
	}
	return c, domainconta.Created{
		ContaID: c.ID, UserEmail: c.UserEmail, Name: c.Name, Kind: c.Kind, OccurredAt: c.CreatedAt,
	}, nil
}

func (s *Service) Update(ctx context.Context, in UpdateInput) (domainconta.Conta, domainconta.Event, error) {
	c, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return domainconta.Conta{}, nil, err
	}
	if err := c.Edit(in.UserEmail, in.Name, in.Status); err != nil {
		return domainconta.Conta{}, nil, err
	}
	if err := s.repo.Update(ctx, c); err != nil {
		return domainconta.Conta{}, nil, err
	}
	return c, domainconta.Updated{
		ContaID: c.ID, UserEmail: c.UserEmail, Name: c.Name, Status: c.Status, OccurredAt: c.UpdatedAt,
	}, nil
}
