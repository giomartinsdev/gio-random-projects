package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/proventos-worker/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/proventos-worker/internal/fundamentus"
)

type fakeDomain struct {
	ativos         []domainapi.Ativo
	movimentos     map[string][]domainapi.Movimento
	transacoes     map[string][]domainapi.Transacao
	creditos       []string
	registros      []string
	falharCreditar bool
}

func (f *fakeDomain) ListTodosAtivos(ctx context.Context) ([]domainapi.Ativo, error) {
	return f.ativos, nil
}

func (f *fakeDomain) ListMovimentos(ctx context.Context, ativoID string) ([]domainapi.Movimento, error) {
	return f.movimentos[ativoID], nil
}

func (f *fakeDomain) ListTransacoes(ctx context.Context, usuarioEmail, contaID string, dia time.Time) ([]domainapi.Transacao, error) {
	return f.transacoes[contaID], nil
}

func (f *fakeDomain) RegistrarProvento(ctx context.Context, ativoID string, valor float64, data time.Time) error {
	f.registros = append(f.registros, ativoID)
	return nil
}

func (f *fakeDomain) CreditarProvento(ctx context.Context, usuarioEmail, contaID, descricao string, valor float64, data time.Time) error {
	if f.falharCreditar {
		return errors.New("falha simulada")
	}
	f.creditos = append(f.creditos, descricao)
	return nil
}

type fakeDividends struct {
	eventos map[string][]fundamentus.Dividend
}

func (f *fakeDividends) FetchDividends(ctx context.Context, ticker string) ([]fundamentus.Dividend, error) {
	return f.eventos[ticker], nil
}

func TestCycle_CreditsAndRegistersOnce(t *testing.T) {
	pagamento := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	domain := &fakeDomain{
		ativos: []domainapi.Ativo{
			{ID: "ativo-1", UsuarioEmail: "ana@example.com", ContaID: "conta-1", Ticker: "PETR4", QuantidadeAtual: 100},
		},
		movimentos: map[string][]domainapi.Movimento{},
		transacoes: map[string][]domainapi.Transacao{},
	}
	dividends := &fakeDividends{eventos: map[string][]fundamentus.Dividend{
		"PETR4": {{DataPagamento: pagamento, ValorPorAcao: 0.5, Tipo: "DIVIDENDO"}},
	}}

	if err := Cycle(context.Background(), domain, dividends); err != nil {
		t.Fatalf("Cycle: %v", err)
	}

	if len(domain.creditos) != 1 {
		t.Fatalf("expected 1 credito, got %d", len(domain.creditos))
	}
	if len(domain.registros) != 1 {
		t.Fatalf("expected 1 movimento registrado, got %d", len(domain.registros))
	}
}

func TestCycle_SkipsAlreadyCreditedTransacao(t *testing.T) {
	pagamento := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	descricao := "Provento PETR4 01/09/2026"
	domain := &fakeDomain{
		ativos: []domainapi.Ativo{
			{ID: "ativo-1", UsuarioEmail: "ana@example.com", ContaID: "conta-1", Ticker: "PETR4", QuantidadeAtual: 100},
		},
		movimentos: map[string][]domainapi.Movimento{},
		transacoes: map[string][]domainapi.Transacao{
			"conta-1": {{Descricao: descricao, Data: pagamento}},
		},
	}
	dividends := &fakeDividends{eventos: map[string][]fundamentus.Dividend{
		"PETR4": {{DataPagamento: pagamento, ValorPorAcao: 0.5, Tipo: "DIVIDENDO"}},
	}}

	if err := Cycle(context.Background(), domain, dividends); err != nil {
		t.Fatalf("Cycle: %v", err)
	}

	// The transação already existed (simulating a prior run that
	// credited but crashed before registering the movimento) -- Cycle
	// must NOT credit it again, but it must still register the
	// movimento to close the gap.
	if len(domain.creditos) != 0 {
		t.Fatalf("expected no new credito, got %d", len(domain.creditos))
	}
	if len(domain.registros) != 1 {
		t.Fatalf("expected the missing movimento to be healed, got %d", len(domain.registros))
	}
}

func TestCycle_SkipsAlreadyRegisteredMovimento(t *testing.T) {
	pagamento := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	domain := &fakeDomain{
		ativos: []domainapi.Ativo{
			{ID: "ativo-1", UsuarioEmail: "ana@example.com", ContaID: "conta-1", Ticker: "PETR4", QuantidadeAtual: 100},
		},
		movimentos: map[string][]domainapi.Movimento{
			"ativo-1": {{Tipo: "provento", Data: pagamento, ValorProvento: 50}},
		},
		transacoes: map[string][]domainapi.Transacao{},
	}
	dividends := &fakeDividends{eventos: map[string][]fundamentus.Dividend{
		"PETR4": {{DataPagamento: pagamento, ValorPorAcao: 0.5, Tipo: "DIVIDENDO"}},
	}}

	if err := Cycle(context.Background(), domain, dividends); err != nil {
		t.Fatalf("Cycle: %v", err)
	}

	// The movimento already existed -- Cycle still credits the
	// transação (it hadn't happened yet in this scenario) but does not
	// register a second movimento for the same date.
	if len(domain.creditos) != 1 {
		t.Fatalf("expected 1 credito, got %d", len(domain.creditos))
	}
	if len(domain.registros) != 0 {
		t.Fatalf("expected no duplicate movimento, got %d", len(domain.registros))
	}
}

func TestCycle_DoesNotRegisterMovimentoWhenCreditFails(t *testing.T) {
	pagamento := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	domain := &fakeDomain{
		ativos: []domainapi.Ativo{
			{ID: "ativo-1", UsuarioEmail: "ana@example.com", ContaID: "conta-1", Ticker: "PETR4", QuantidadeAtual: 100},
		},
		movimentos:     map[string][]domainapi.Movimento{},
		transacoes:     map[string][]domainapi.Transacao{},
		falharCreditar: true,
	}
	dividends := &fakeDividends{eventos: map[string][]fundamentus.Dividend{
		"PETR4": {{DataPagamento: pagamento, ValorPorAcao: 0.5, Tipo: "DIVIDENDO"}},
	}}

	if err := Cycle(context.Background(), domain, dividends); err != nil {
		t.Fatalf("Cycle: %v", err)
	}

	if len(domain.registros) != 0 {
		t.Fatalf("expected no movimento registered when the credit failed, got %d", len(domain.registros))
	}
}
