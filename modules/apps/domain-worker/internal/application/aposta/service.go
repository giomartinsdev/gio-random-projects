package aposta

import (
	"context"

	domainaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/aposta"
)

// Service is the use case: the only thing that calls
// domainaposta.Repository's write methods, so every mutation goes
// through the aggregate's own invariants (New/Resolver) -- same shape
// as application/conta.Service.
type Service struct {
	repo domainaposta.Repository
}

func NewService(repo domainaposta.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Registrar(ctx context.Context, id string, in RegistrarInput) (domainaposta.Aposta, domainaposta.Event, error) {
	a, err := domainaposta.New(id, in.UserEmail, in.ContaID, in.Descricao, in.ValorApostado, in.Odd, in.Data)
	if err != nil {
		return domainaposta.Aposta{}, nil, err
	}
	if err := s.repo.Insert(ctx, a); err != nil {
		return domainaposta.Aposta{}, nil, err
	}
	return a, domainaposta.Registrada{
		ApostaID: a.ID, UserEmail: a.UserEmail, ContaID: a.ContaID,
		ValorApostado: a.ValorApostado, OccurredAt: a.CreatedAt,
	}, nil
}

func (s *Service) Resolver(ctx context.Context, in ResolverInput) (domainaposta.Aposta, domainaposta.Event, error) {
	a, err := s.repo.FindByID(ctx, in.ApostaID)
	if err != nil {
		return domainaposta.Aposta{}, nil, err
	}
	resolvida, err := a.Resolver(in.Status, in.RetornoObtido, in.Data)
	if err != nil {
		return domainaposta.Aposta{}, nil, err
	}
	if err := s.repo.Update(ctx, resolvida); err != nil {
		return domainaposta.Aposta{}, nil, err
	}
	return resolvida, domainaposta.Resolvida{
		ApostaID: resolvida.ID, Status: resolvida.Status,
		RetornoObtido: resolvida.RetornoObtido, OccurredAt: resolvida.UpdatedAt,
	}, nil
}
