package transacao

import (
	"testing"
	"time"
)

func TestNew(t *testing.T) {
	data := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)

	t.Run("positive: valid input", func(t *testing.T) {
		tr, err := New("id-1", "a@example.com", "conta-1", TipoSaida, 50, data, "mercado", "", "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tr.Valor != 50 {
			t.Errorf("valor = %v, want 50", tr.Valor)
		}
	})

	t.Run("negative: invalid tipo", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "conta-1", "transferencia", 50, data, "mercado", "", "")
		if err != ErrTipoInvalido {
			t.Errorf("err = %v, want ErrTipoInvalido", err)
		}
	})

	t.Run("negative: valor zero", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "conta-1", TipoSaida, 0, data, "mercado", "", "")
		if err != ErrValorInvalido {
			t.Errorf("err = %v, want ErrValorInvalido", err)
		}
	})

	t.Run("negative: valor negativo", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "conta-1", TipoSaida, -10, data, "mercado", "", "")
		if err != ErrValorInvalido {
			t.Errorf("err = %v, want ErrValorInvalido", err)
		}
	})

	t.Run("negative: data zero value", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "conta-1", TipoSaida, 50, time.Time{}, "mercado", "", "")
		if err != ErrDataInvalida {
			t.Errorf("err = %v, want ErrDataInvalida", err)
		}
	})

	t.Run("negative: missing categoria", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "conta-1", TipoSaida, 50, data, "", "", "")
		if err != ErrCategoriaRequired {
			t.Errorf("err = %v, want ErrCategoriaRequired", err)
		}
	})
}

func TestEdit(t *testing.T) {
	data := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)

	t.Run("negative: non-owner is forbidden", func(t *testing.T) {
		tr, _ := New("id-1", "a@example.com", "conta-1", TipoSaida, 50, data, "mercado", "", "")
		if err := tr.Edit("b@example.com", "", nil, nil, "", "", ""); err != ErrForbidden {
			t.Errorf("err = %v, want ErrForbidden", err)
		}
	})

	t.Run("negative: new valor invalid", func(t *testing.T) {
		tr, _ := New("id-1", "a@example.com", "conta-1", TipoSaida, 50, data, "mercado", "", "")
		novoValor := -5.0
		if err := tr.Edit("a@example.com", "", &novoValor, nil, "", "", ""); err != ErrValorInvalido {
			t.Errorf("err = %v, want ErrValorInvalido", err)
		}
	})

	t.Run("positive: partial update leaves other fields untouched", func(t *testing.T) {
		tr, _ := New("id-1", "a@example.com", "conta-1", TipoSaida, 50, data, "mercado", "desc", "")
		novoValor := 75.0
		if err := tr.Edit("a@example.com", "", &novoValor, nil, "", "", ""); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if tr.Valor != 75 || tr.Categoria != "mercado" || tr.Descricao != "desc" {
			t.Errorf("unexpected state: %+v", tr)
		}
	})
}
