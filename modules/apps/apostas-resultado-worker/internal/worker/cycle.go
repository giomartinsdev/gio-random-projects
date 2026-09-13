// Package worker holds the one sweep apostas-resultado-worker exists
// to run: every pending aposta in the system, checked once against a
// real match result -- resolved only when confidence is high enough
// that a wrong resolve (crediting money that wasn't won, or failing to
// credit money that was) can't happen. See this repo's plan doc for
// the full reasoning; the short version is "never guess -- an
// unresolved aposta just tries again tomorrow".
package worker

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/ai"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/sportsdata"
)

// janelaDiasBusca is how many days after an aposta was placed the
// sportsdata lookup keeps searching for the match it refers to -- bets
// are usually placed shortly before a game, not registered the same
// day it's played.
const janelaDiasBusca = 4

type domainClient interface {
	ListPendentes(ctx context.Context) ([]domainapi.Aposta, error)
	ResolverAposta(ctx context.Context, apostaID, status string, retornoObtido float64, data time.Time) error
	CreditarRetorno(ctx context.Context, usuarioEmail, contaID, descricao string, valor float64, data time.Time) error
}

type reasoner interface {
	ExtrairEvento(ctx context.Context, descricao string, dataAposta time.Time) (ai.Evento, error)
	DecidirResultado(ctx context.Context, evento ai.Evento, placarA, placarB int) (ai.Resultado, error)
}

type placarSource interface {
	BuscarPlacar(ctx context.Context, timeA, timeB string, desde time.Time, janelaDias int) (sportsdata.Placar, error)
}

// Cycle runs one full sweep: list every pending aposta, and for each,
// try to resolve it -- one aposta failing (AI down, game not found, no
// confident market read) is logged and skipped, never aborts the rest
// of the sweep, same resilience principle as proventos-worker's Cycle.
func Cycle(ctx context.Context, domain domainClient, reasoning reasoner, scores placarSource) error {
	apostas, err := domain.ListPendentes(ctx)
	if err != nil {
		return fmt.Errorf("listar apostas pendentes: %w", err)
	}

	for _, aposta := range apostas {
		if err := resolverAposta(ctx, domain, reasoning, scores, aposta); err != nil {
			log.Printf("apostas-resultado-worker: aposta %s não resolvida: %v", aposta.ID, err)
		}
	}
	return nil
}

func resolverAposta(ctx context.Context, domain domainClient, reasoning reasoner, scores placarSource, aposta domainapi.Aposta) error {
	evento, err := reasoning.ExtrairEvento(ctx, aposta.Descricao, aposta.DataAposta)
	if err != nil {
		return fmt.Errorf("extrair evento: %w", err)
	}
	if evento.Confianca != "alta" || evento.ParticipanteA == "" || evento.ParticipanteB == "" {
		return fmt.Errorf("evento não identificado com confiança (confianca=%q)", evento.Confianca)
	}

	placar, err := scores.BuscarPlacar(ctx, evento.ParticipanteA, evento.ParticipanteB, aposta.DataAposta, janelaDiasBusca)
	if err != nil {
		return fmt.Errorf("buscar placar: %w", err)
	}

	resultado, err := reasoning.DecidirResultado(ctx, evento, placar.GolsCasa, placar.GolsFora)
	if err != nil {
		return fmt.Errorf("decidir resultado: %w", err)
	}
	if resultado.Confianca != "alta" {
		return fmt.Errorf("resultado sem confiança alta (confianca=%q, placar=%d-%d)", resultado.Confianca, placar.GolsCasa, placar.GolsFora)
	}
	if resultado.Resultado != "green" && resultado.Resultado != "red" && resultado.Resultado != "cancelada" {
		return fmt.Errorf("resultado inesperado da IA: %q", resultado.Resultado)
	}

	var retornoObtido float64
	if resultado.Resultado == "green" {
		retornoObtido = aposta.ValorApostado * aposta.Odd
	} else if resultado.Resultado == "cancelada" {
		retornoObtido = aposta.ValorApostado // refund, same rule the manual flow already applies
	}

	agora := time.Now()
	if err := domain.ResolverAposta(ctx, aposta.ID, resultado.Resultado, retornoObtido, agora); err != nil {
		return fmt.Errorf("resolver aposta: %w", err)
	}
	log.Printf("apostas-resultado-worker: aposta %s resolvida como %s (placar %d-%d)", aposta.ID, resultado.Resultado, placar.GolsCasa, placar.GolsFora)

	if retornoObtido > 0 {
		descricao := fmt.Sprintf("Retorno aposta: %s", aposta.Descricao)
		if err := domain.CreditarRetorno(ctx, aposta.UsuarioEmail, aposta.ContaID, descricao, retornoObtido, agora); err != nil {
			// The aposta is already resolved at this point -- a failed
			// credit here is a real inconsistency, but not one this
			// worker can safely retry blindly (retrying would credit
			// twice if the first call actually landed). Logged loudly
			// for manual reconciliation, same as any other lançamento
			// correction in this app.
			return fmt.Errorf("aposta %s resolvida como %s mas o crédito falhou -- reconciliar na mão: %w", aposta.ID, resultado.Resultado, err)
		}
	}
	return nil
}
