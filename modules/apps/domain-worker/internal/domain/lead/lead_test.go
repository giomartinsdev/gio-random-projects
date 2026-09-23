package lead

import "testing"

func TestNew(t *testing.T) {
	l, err := New("id-1", "  Ana@Exemplo.com  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if l.Email != "ana@exemplo.com" {
		t.Fatalf("expected lowercased/trimmed email, got %q", l.Email)
	}
	if l.CreatedAt.IsZero() {
		t.Fatal("expected CreatedAt to be set")
	}
}

func TestNewRejeitaEmailInvalido(t *testing.T) {
	casos := []string{"", "  ", "sem-arroba", "@sem-usuario.com", "usuario@", "a@b@c.com"}
	for _, email := range casos {
		if _, err := New("id-1", email); err == nil {
			t.Errorf("esperava error to_division email %q", email)
		}
	}
}
