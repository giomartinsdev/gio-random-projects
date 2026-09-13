// Package worker holds the one sweep proventos-worker exists to run:
// every open position in the system, checked once against
// fundamentus.com.br for a dividend event this app hasn't recorded yet.
package worker

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/proventos-worker/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/proventos-worker/internal/fundamentus"
)

// domainClient and dividendSource are the two dependencies Cycle needs,
// narrowed to what it actually calls -- lets a test fake either without
// standing up a real domainapi.Client or fundamentus.Client.
type domainClient interface {
	ListTodosAtivos(ctx context.Context) ([]domainapi.Ativo, error)
	ListMovimentos(ctx context.Context, ativoID string) ([]domainapi.Movimento, error)
	ListTransacoes(ctx context.Context, usuarioEmail, contaID string, dia time.Time) ([]domainapi.Transacao, error)
	RegistrarProvento(ctx context.Context, ativoID string, valor float64, data time.Time) error
	CreditarProvento(ctx context.Context, usuarioEmail, contaID, descricao string, valor float64, data time.Time) error
}

type dividendSource interface {
	FetchDividends(ctx context.Context, ticker string) ([]fundamentus.Dividend, error)
}

// Cycle runs one full sweep: list every open ativo, group by ticker so
// a ticker held by many people is only fetched once, then for each
// dividend event not yet recorded, credit the conta and register the
// movimento -- in that order, so a crash between the two steps always
// self-heals on the next run instead of silently dropping the credit
// (see the two "ja existe" checks below, each independently
// idempotent).
func Cycle(ctx context.Context, domain domainClient, dividends dividendSource) error {
	ativos, err := domain.ListTodosAtivos(ctx)
	if err != nil {
		return fmt.Errorf("listar ativos: %w", err)
	}

	porTicker := make(map[string][]domainapi.Ativo)
	for _, a := range ativos {
		porTicker[a.Ticker] = append(porTicker[a.Ticker], a)
	}

	for ticker, posicoes := range porTicker {
		eventos, err := dividends.FetchDividends(ctx, ticker)
		if err != nil {
			// One bad ticker (fundamentus down, unknown ticker, a
			// changed page) never aborts the whole day's sweep -- every
			// other ticker still gets processed, and this one is
			// retried tomorrow.
			log.Printf("proventos-worker: buscar dividendos de %s: %v", ticker, err)
			continue
		}
		for _, ativo := range posicoes {
			for _, evento := range eventos {
				processarEvento(ctx, domain, ativo, evento)
			}
		}
	}
	return nil
}

func processarEvento(ctx context.Context, domain domainClient, ativo domainapi.Ativo, evento fundamentus.Dividend) {
	valor := evento.ValorPorAcao * ativo.QuantidadeAtual
	if valor <= 0 {
		return
	}
	descricao := fmt.Sprintf("Provento %s %s", ativo.Ticker, evento.DataPagamento.Format("02/01/2006"))

	transacoes, err := domain.ListTransacoes(ctx, ativo.UsuarioEmail, ativo.ContaID, evento.DataPagamento)
	if err != nil {
		log.Printf("proventos-worker: checar transações de %s (%s): %v", ativo.Ticker, ativo.ID, err)
		return
	}
	if !contemDescricao(transacoes, descricao) {
		if err := domain.CreditarProvento(ctx, ativo.UsuarioEmail, ativo.ContaID, descricao, valor, evento.DataPagamento); err != nil {
			log.Printf("proventos-worker: creditar provento %s: %v", descricao, err)
			return // sem crédito, não registra o movimento ainda -- tenta os dois de novo amanhã
		}
	}

	movimentos, err := domain.ListMovimentos(ctx, ativo.ID)
	if err != nil {
		log.Printf("proventos-worker: checar movimentos de %s (%s): %v", ativo.Ticker, ativo.ID, err)
		return
	}
	if !contemProventoNaData(movimentos, evento.DataPagamento) {
		if err := domain.RegistrarProvento(ctx, ativo.ID, valor, evento.DataPagamento); err != nil {
			log.Printf("proventos-worker: registrar movimento %s: %v", descricao, err)
		}
	}
}

func contemDescricao(transacoes []domainapi.Transacao, descricao string) bool {
	for _, t := range transacoes {
		if t.Descricao == descricao {
			return true
		}
	}
	return false
}

func contemProventoNaData(movimentos []domainapi.Movimento, data time.Time) bool {
	for _, m := range movimentos {
		if m.Tipo == "provento" && mesmoDia(m.Data, data) {
			return true
		}
	}
	return false
}

func mesmoDia(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}
