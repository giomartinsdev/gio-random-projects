package ativo

import (
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativomovimento"
)

var data = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)

func TestNew(t *testing.T) {
	t.Run("positive: creates ativo aberta with first compra movimento", func(t *testing.T) {
		a, mov, err := New("id-1", "a@example.com", "conta-1", "PETR4", 100, 20, data)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if a.Status != StatusAberta {
			t.Errorf("status = %q, want %q", a.Status, StatusAberta)
		}
		if a.QuantidadeAtual != 100 || a.CustoMedio != 20 {
			t.Errorf("got quantidade=%v custoMedio=%v", a.QuantidadeAtual, a.CustoMedio)
		}
		if mov.Kind != ativomovimento.TipoCompra {
			t.Errorf("mov.Kind = %q, want compra", mov.Kind)
		}
	})

	t.Run("negative: quantidade invalida", func(t *testing.T) {
		_, _, err := New("id-1", "a@example.com", "conta-1", "PETR4", 0, 20, data)
		if err != ErrQuantidadeInvalida {
			t.Errorf("err = %v, want ErrQuantidadeInvalida", err)
		}
	})
}

func TestRegistrarMovimento(t *testing.T) {
	base := func() Ativo {
		a, _, _ := New("id-1", "a@example.com", "conta-1", "PETR4", 100, 20, data)
		return a
	}

	t.Run("positive: compra recalcula custo medio ponderado", func(t *testing.T) {
		a := base()
		updated, mov, err := RegistrarMovimento(a, ativomovimento.TipoCompra, 100, 30, 0, data)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if updated.QuantidadeAtual != 200 {
			t.Errorf("quantidade = %v, want 200", updated.QuantidadeAtual)
		}
		wantCusto := (100*20.0 + 100*30.0) / 200
		if updated.CustoMedio != wantCusto {
			t.Errorf("custoMedio = %v, want %v", updated.CustoMedio, wantCusto)
		}
		if mov.Kind != ativomovimento.TipoCompra {
			t.Errorf("mov.Kind = %q", mov.Kind)
		}
	})

	t.Run("negative: venda excede quantidade disponivel", func(t *testing.T) {
		a := base()
		_, _, err := RegistrarMovimento(a, ativomovimento.TipoVenda, 150, 25, 0, data)
		if err != ErrQuantidadeInsuficiente {
			t.Errorf("err = %v, want ErrQuantidadeInsuficiente", err)
		}
	})

	t.Run("positive: venda parcial calcula resultado realizado e mantem aberta", func(t *testing.T) {
		a := base()
		updated, mov, err := RegistrarMovimento(a, ativomovimento.TipoVenda, 40, 25, 0, data)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		wantResultado := 40 * (25.0 - 20.0)
		if mov.ResultadoRealizado != wantResultado {
			t.Errorf("resultado = %v, want %v", mov.ResultadoRealizado, wantResultado)
		}
		if updated.QuantidadeAtual != 60 {
			t.Errorf("quantidade = %v, want 60", updated.QuantidadeAtual)
		}
		if updated.Status != StatusAberta {
			t.Errorf("status = %q, want aberta", updated.Status)
		}
	})

	t.Run("positive: venda total zera position e encerra ativo", func(t *testing.T) {
		a := base()
		updated, _, err := RegistrarMovimento(a, ativomovimento.TipoVenda, 100, 25, 0, data)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if updated.QuantidadeAtual != 0 {
			t.Errorf("quantidade = %v, want 0", updated.QuantidadeAtual)
		}
		if updated.Status != StatusEncerrada {
			t.Errorf("status = %q, want encerrada", updated.Status)
		}
	})

	t.Run("positive: provento nao altera quantidade nem custo", func(t *testing.T) {
		a := base()
		updated, mov, err := RegistrarMovimento(a, ativomovimento.TipoProvento, 0, 0, 15.5, data)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if updated.QuantidadeAtual != 100 || updated.CustoMedio != 20 {
			t.Errorf("provento alterou position: %+v", updated)
		}
		if mov.ValorProvento != 15.5 {
			t.Errorf("valorProvento = %v, want 15.5", mov.ValorProvento)
		}
	})

	t.Run("negative: kind invalido", func(t *testing.T) {
		a := base()
		_, _, err := RegistrarMovimento(a, "resgate", 1, 1, 0, data)
		if err != ErrTipoMovimentoInvalido {
			t.Errorf("err = %v, want ErrTipoMovimentoInvalido", err)
		}
	})
}
