package worker

import (
	"context"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/ai"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/sportsdata"
)

type fakeDomain struct {
	pendentes  []domainapi.Aposta
	resolved   map[string]string
	credited   map[string]float64
	resolveErr error
}

func (f *fakeDomain) ListPendentes(ctx context.Context) ([]domainapi.Aposta, error) {
	return f.pendentes, nil
}
func (f *fakeDomain) ResolverAposta(ctx context.Context, apostaID, status string, retornoObtido float64, data time.Time) error {
	if f.resolveErr != nil {
		return f.resolveErr
	}
	if f.resolved == nil {
		f.resolved = map[string]string{}
	}
	f.resolved[apostaID] = status
	return nil
}
func (f *fakeDomain) CreditarRetorno(ctx context.Context, usuarioEmail, contaID, descricao string, valor float64, data time.Time) error {
	if f.credited == nil {
		f.credited = map[string]float64{}
	}
	f.credited[usuarioEmail] = valor
	return nil
}

type fakeReasoner struct {
	evento    ai.Evento
	resultado ai.Resultado
}

func (f *fakeReasoner) ExtrairEvento(ctx context.Context, descricao string, dataAposta time.Time) (ai.Evento, error) {
	return f.evento, nil
}
func (f *fakeReasoner) DecidirResultado(ctx context.Context, evento ai.Evento, placarA, placarB int) (ai.Resultado, error) {
	return f.resultado, nil
}

type fakeScores struct{}

func (fakeScores) BuscarPlacar(ctx context.Context, timeA, timeB string, desde time.Time, janelaDias int) (sportsdata.Placar, error) {
	return sportsdata.Placar{GolsCasa: 2, GolsFora: 1}, nil
}

func TestCycleResolveComConfiancaAlta(t *testing.T) {
	domain := &fakeDomain{pendentes: []domainapi.Aposta{
		{ID: "a1", UsuarioEmail: "u@x.com", ContaID: "c1", Descricao: "Real Madrid vence", ValorApostado: 50, Odd: 1.8},
	}}
	reasoning := &fakeReasoner{
		evento:    ai.Evento{ParticipanteA: "Real Madrid", ParticipanteB: "Barcelona", Mercado: "vencedor", Confianca: "alta"},
		resultado: ai.Resultado{Resultado: "green", Confianca: "alta"},
	}

	if err := Cycle(context.Background(), domain, reasoning, fakeScores{}); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if domain.resolved["a1"] != "green" {
		t.Fatalf("esperava aposta a1 resolvida como green, resolved=%v", domain.resolved)
	}
	if domain.credited["u@x.com"] != 90 {
		t.Fatalf("esperava crédito de 90 (50*1.8), veio %v", domain.credited)
	}
}

func TestCycleNaoResolveComConfiancaBaixa(t *testing.T) {
	domain := &fakeDomain{pendentes: []domainapi.Aposta{
		{ID: "a1", UsuarioEmail: "u@x.com", ContaID: "c1", Descricao: "algo vago", ValorApostado: 50, Odd: 1.8},
	}}
	reasoning := &fakeReasoner{
		evento: ai.Evento{Confianca: "baixa"},
	}

	if err := Cycle(context.Background(), domain, reasoning, fakeScores{}); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if len(domain.resolved) != 0 {
		t.Fatalf("não esperava nenhuma aposta resolvida, resolved=%v", domain.resolved)
	}
}

func TestCycleNaoResolveQuandoResultadoIncerto(t *testing.T) {
	domain := &fakeDomain{pendentes: []domainapi.Aposta{
		{ID: "a1", UsuarioEmail: "u@x.com", ContaID: "c1", Descricao: "Real Madrid vence", ValorApostado: 50, Odd: 1.8},
	}}
	reasoning := &fakeReasoner{
		evento:    ai.Evento{ParticipanteA: "Real Madrid", ParticipanteB: "Barcelona", Mercado: "vencedor", Confianca: "alta"},
		resultado: ai.Resultado{Resultado: "green", Confianca: "baixa"},
	}

	if err := Cycle(context.Background(), domain, reasoning, fakeScores{}); err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if len(domain.resolved) != 0 {
		t.Fatalf("não esperava resolução sem confiança alta, resolved=%v", domain.resolved)
	}
}
