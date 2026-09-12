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
	c, err := domainconta.New(id, in.UsuarioEmail, in.Nome, in.Tipo)
	if err != nil {
		return domainconta.Conta{}, nil, err
	}
	if err := s.repo.Insert(ctx, c); err != nil {
		return domainconta.Conta{}, nil, err
	}
	return c, domainconta.Created{
		ContaID: c.ID, UsuarioEmail: c.UsuarioEmail, Nome: c.Nome, Tipo: c.Tipo, OccurredAt: c.CriadoEm,
	}, nil
}

func (s *Service) Update(ctx context.Context, in UpdateInput) (domainconta.Conta, domainconta.Event, error) {
	c, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return domainconta.Conta{}, nil, err
	}
	if err := c.Edit(in.UsuarioEmail, in.Nome, in.Status); err != nil {
		return domainconta.Conta{}, nil, err
	}
	if err := s.repo.Update(ctx, c); err != nil {
		return domainconta.Conta{}, nil, err
	}
	return c, domainconta.Updated{
		ContaID: c.ID, UsuarioEmail: c.UsuarioEmail, Nome: c.Nome, Status: c.Status, OccurredAt: c.AtualizadoEm,
	}, nil
}
