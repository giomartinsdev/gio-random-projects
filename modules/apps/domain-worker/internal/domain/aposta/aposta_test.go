package aposta

import (
	"testing"
	"time"
)

var data = time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)

func TestNew(t *testing.T) {
	t.Run("positive: registra aposta pendente", func(t *testing.T) {
		a, err := New("id-1", "a@example.com", "conta-1", "Real Madrid vence", 100, 1.8, data)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if a.Status != StatusPendente {
			t.Errorf("status = %q, want %q", a.Status, StatusPendente)
		}
		if a.ValorApostado != 100 {
			t.Errorf("valorApostado = %v, want 100", a.ValorApostado)
		}
	})

	t.Run("negative: valor invalido", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "conta-1", "desc", 0, 1.8, data)
		if err != ErrValorInvalido {
			t.Errorf("err = %v, want ErrValorInvalido", err)
		}
	})

	t.Run("negative: descricao vazia", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "conta-1", "", 100, 1.8, data)
		if err != ErrDescricaoRequired {
			t.Errorf("err = %v, want ErrDescricaoRequired", err)
		}
	})
}

func TestResolver(t *testing.T) {
	base := func() Aposta {
		a, _ := New("id-1", "a@example.com", "conta-1", "Real Madrid vence", 100, 1.8, data)
		return a
	}
	resultado := data.AddDate(0, 0, 1)

	t.Run("positive: green registra retorno obtido", func(t *testing.T) {
		updated, err := base().Resolver(StatusGreen, 180, resultado)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if updated.Status != StatusGreen {
			t.Errorf("status = %q, want %q", updated.Status, StatusGreen)
		}
		if updated.RetornoObtido != 180 {
			t.Errorf("retornoObtido = %v, want 180", updated.RetornoObtido)
		}
		if !updated.DataResultado.Equal(resultado) {
			t.Errorf("dataResultado = %v, want %v", updated.DataResultado, resultado)
		}
	})

	t.Run("positive: red nao seta retorno obtido", func(t *testing.T) {
		updated, err := base().Resolver(StatusRed, 0, resultado)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if updated.Status != StatusRed {
			t.Errorf("status = %q, want %q", updated.Status, StatusRed)
		}
		if updated.RetornoObtido != 0 {
			t.Errorf("retornoObtido = %v, want 0", updated.RetornoObtido)
		}
	})

	t.Run("positive: cancelada reembolsa o valor apostado", func(t *testing.T) {
		updated, err := base().Resolver(StatusCancelada, 0, resultado)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if updated.RetornoObtido != 100 {
			t.Errorf("retornoObtido = %v, want 100 (reembolso integral)", updated.RetornoObtido)
		}
	})

	t.Run("negative: green sem retorno obtido", func(t *testing.T) {
		_, err := base().Resolver(StatusGreen, 0, resultado)
		if err != ErrRetornoInvalido {
			t.Errorf("err = %v, want ErrRetornoInvalido", err)
		}
	})

	t.Run("negative: status invalido", func(t *testing.T) {
		_, err := base().Resolver("meio-green", 50, resultado)
		if err != ErrStatusInvalido {
			t.Errorf("err = %v, want ErrStatusInvalido", err)
		}
	})

	t.Run("negative: nao pode resolver duas vezes", func(t *testing.T) {
		once, err := base().Resolver(StatusRed, 0, resultado)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if _, err := once.Resolver(StatusGreen, 100, resultado); err != ErrApostaJaResolvida {
			t.Errorf("err = %v, want ErrApostaJaResolvida", err)
		}
	})
}
