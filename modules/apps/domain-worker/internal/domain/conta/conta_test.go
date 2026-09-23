package conta

import "testing"

func TestNew(t *testing.T) {
	t.Run("positive: valid input creates an ativa conta", func(t *testing.T) {
		c, err := New("id-1", "a@example.com", "Nubank", TipoCorrente)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if c.Status != StatusAtiva {
			t.Errorf("status = %q, want %q", c.Status, StatusAtiva)
		}
	})

	t.Run("negative: missing user_email", func(t *testing.T) {
		_, err := New("id-1", "", "Nubank", TipoCorrente)
		if err != ErrUsuarioRequired {
			t.Errorf("err = %v, want ErrUsuarioRequired", err)
		}
	})

	t.Run("negative: missing name", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "", TipoCorrente)
		if err != ErrNomeRequired {
			t.Errorf("err = %v, want ErrNomeRequired", err)
		}
	})

	t.Run("negative: invalid kind", func(t *testing.T) {
		_, err := New("id-1", "a@example.com", "Nubank", "poupanca")
		if err != ErrTipoInvalido {
			t.Errorf("err = %v, want ErrTipoInvalido", err)
		}
	})
}

func TestEdit(t *testing.T) {
	t.Run("positive: owner edits name and status", func(t *testing.T) {
		c, _ := New("id-1", "a@example.com", "Nubank", TipoCorrente)
		if err := c.Edit("a@example.com", "Nubank PJ", StatusArquivada); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if c.Name != "Nubank PJ" || c.Status != StatusArquivada {
			t.Errorf("got name=%q status=%q", c.Name, c.Status)
		}
	})

	t.Run("negative: non-owner is forbidden", func(t *testing.T) {
		c, _ := New("id-1", "a@example.com", "Nubank", TipoCorrente)
		if err := c.Edit("b@example.com", "x", ""); err != ErrForbidden {
			t.Errorf("err = %v, want ErrForbidden", err)
		}
	})

	t.Run("negative: invalid status", func(t *testing.T) {
		c, _ := New("id-1", "a@example.com", "Nubank", TipoCorrente)
		if err := c.Edit("a@example.com", "", "fechada"); err != ErrStatusInvalido {
			t.Errorf("err = %v, want ErrStatusInvalido", err)
		}
	})

	t.Run("positive: empty fields leave values unchanged", func(t *testing.T) {
		c, _ := New("id-1", "a@example.com", "Nubank", TipoCorrente)
		if err := c.Edit("a@example.com", "", ""); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if c.Name != "Nubank" || c.Status != StatusAtiva {
			t.Errorf("got name=%q status=%q", c.Name, c.Status)
		}
	})
}
