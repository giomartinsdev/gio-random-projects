package dashboardlayout

import "testing"

func TestSave(t *testing.T) {
	t.Run("positive: valid array", func(t *testing.T) {
		d, err := Save("a@example.com", []byte(`[{"id":"b1"}]`))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if d.UserEmail != "a@example.com" {
			t.Errorf("usuario = %q", d.UserEmail)
		}
	})

	t.Run("negative: missing user_email", func(t *testing.T) {
		_, err := Save("", []byte(`[]`))
		if err != ErrUsuarioRequired {
			t.Errorf("err = %v, want ErrUsuarioRequired", err)
		}
	})

	t.Run("negative: not an array", func(t *testing.T) {
		_, err := Save("a@example.com", []byte(`{"foo":"bar"}`))
		if err != ErrBlocosInvalido {
			t.Errorf("err = %v, want ErrBlocosInvalido", err)
		}
	})

	t.Run("negative: invalid json", func(t *testing.T) {
		_, err := Save("a@example.com", []byte(`not json`))
		if err != ErrBlocosInvalido {
			t.Errorf("err = %v, want ErrBlocosInvalido", err)
		}
	})
}
