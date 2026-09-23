package transacao

import (
	"context"
	"time"

	domaintransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/transacao"
)

// Service is the use case: the only thing that calls
// domaintransacao.Repository's write methods, so every mutation goes
// through the aggregate's own invariants (New/Edit) -- same shape as
// application/room.Service.
type Service struct {
	repo domaintransacao.Repository
}

func NewService(repo domaintransacao.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, id string, in CreateInput) (domaintransacao.Transacao, domaintransacao.Event, error) {
	tr, err := domaintransacao.New(id, in.UsuarioEmail, in.ContaID, in.Tipo, in.Valor, in.Data, in.Categoria, in.Descricao, in.AnexoImagem)
	if err != nil {
		return domaintransacao.Transacao{}, nil, err
	}
	if err := s.repo.Insert(ctx, tr); err != nil {
		return domaintransacao.Transacao{}, nil, err
	}
	return tr, domaintransacao.Created{
		TransacaoID: tr.ID, UsuarioEmail: tr.UsuarioEmail, ContaID: tr.ContaID, Tipo: tr.Tipo, Valor: tr.Valor, OccurredAt: tr.CriadoEm,
	}, nil
}

func (s *Service) Update(ctx context.Context, in UpdateInput) (domaintransacao.Transacao, domaintransacao.Event, error) {
	tr, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return domaintransacao.Transacao{}, nil, err
	}
	if err := tr.Edit(in.UsuarioEmail, in.Tipo, in.Valor, in.Data, in.Categoria, in.Descricao, in.AnexoImagem); err != nil {
		return domaintransacao.Transacao{}, nil, err
	}
	if err := s.repo.Update(ctx, tr); err != nil {
		return domaintransacao.Transacao{}, nil, err
	}
	return tr, domaintransacao.Updated{
		TransacaoID: tr.ID, UsuarioEmail: tr.UsuarioEmail, ContaID: tr.ContaID, Tipo: tr.Tipo, Valor: tr.Valor, OccurredAt: tr.AtualizadoEm,
	}, nil
}

func (s *Service) Delete(ctx context.Context, in DeleteInput) (domaintransacao.Event, error) {
	tr, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if in.UsuarioEmail != tr.UsuarioEmail {
		return nil, domaintransacao.ErrForbidden
	}
	if err := s.repo.Delete(ctx, in.ID); err != nil {
		return nil, err
	}
	return domaintransacao.Deleted{
		TransacaoID: tr.ID, UsuarioEmail: tr.UsuarioEmail, ContaID: tr.ContaID, OccurredAt: time.Now().UTC(),
	}, nil
}
