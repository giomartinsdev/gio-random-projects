package ativo

import (
	"context"
	"time"

	"github.com/google/uuid"

	domainativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativo"
)

// Service is the use case: the only thing that calls
// domainativo.Repository's write methods, so every mutation goes
// through the aggregate's own invariants (New/RegistrarMovimento) --
// same shape as application/room.Service.
type Service struct {
	repo domainativo.Repository
}

func NewService(repo domainativo.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, id string, in CreateInput) (domainativo.Ativo, domainativo.Event, error) {
	a, mov, err := domainativo.New(id, in.UsuarioEmail, in.ContaID, in.Ticker, in.QuantidadeInicial, in.PrecoUnitario, in.Data)
	if err != nil {
		return domainativo.Ativo{}, nil, err
	}
	mov.ID = uuid.NewString()
	if err := s.repo.Insert(ctx, a, mov); err != nil {
		return domainativo.Ativo{}, nil, err
	}
	return a, domainativo.Created{
		AtivoID: a.ID, UsuarioEmail: a.UsuarioEmail, ContaID: a.ContaID, Ticker: a.Ticker, OccurredAt: a.CriadoEm,
	}, nil
}

func (s *Service) RegisterMovement(ctx context.Context, in RegisterMovementInput) (domainativo.Ativo, domainativo.Event, error) {
	a, err := s.repo.FindByID(ctx, in.AtivoID)
	if err != nil {
		return domainativo.Ativo{}, nil, err
	}
	updated, mov, err := domainativo.RegistrarMovimento(a, in.Tipo, in.Quantidade, in.PrecoUnitario, in.ValorProvento, in.Data)
	if err != nil {
		return domainativo.Ativo{}, nil, err
	}
	mov.ID = uuid.NewString()
	if err := s.repo.InsertMovimento(ctx, updated, mov); err != nil {
		return domainativo.Ativo{}, nil, err
	}
	return updated, domainativo.MovimentoRegistrado{
		AtivoID:            updated.ID,
		MovimentoID:        mov.ID,
		Tipo:               mov.Tipo,
		QuantidadeAtual:    updated.QuantidadeAtual,
		CustoMedio:         updated.CustoMedio,
		Status:             updated.Status,
		ResultadoRealizado: mov.ResultadoRealizado,
		OccurredAt:         time.Now().UTC(),
	}, nil
}

// UpdateQuote skips the domain aggregate entirely -- refreshing a
// quote never touches quantidade/custo_medio/status, so this goes
// straight at the repository (see AtivoRepository.UpdateCotacao), same
// carve-out the spec calls for.
func (s *Service) UpdateQuote(ctx context.Context, in UpdateQuoteInput) (domainativo.Event, error) {
	if err := s.repo.UpdateCotacao(ctx, in.AtivoID, in.Cotacao, in.ObtidaEm); err != nil {
		return nil, err
	}
	return domainativo.CotacaoAtualizada{AtivoID: in.AtivoID, UltimaCotacao: in.Cotacao, OccurredAt: time.Now().UTC()}, nil
}
