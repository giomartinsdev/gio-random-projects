package httpapi

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-api/internal/domainapi"
)

func TestCasarConta(t *testing.T) {
	contas := []domainapi.Conta{
		{ID: "c1", Nome: "Bet365", Tipo: "aposta"},
		{ID: "c2", Nome: "Betano", Tipo: "aposta"},
		{ID: "c3", Nome: "Nubank", Tipo: "corrente"},
	}

	cases := []struct {
		name    string
		casa    string
		wantID  string
		wantNil bool
	}{
		{name: "exact case-insensitive", casa: "bet365", wantID: "c1"},
		{name: "substring both ways", casa: "Bet365 - Boletim de aposta", wantID: "c1"},
		{name: "no match", casa: "KTO", wantNil: true},
		{name: "never matches a non-aposta conta", casa: "Nubank", wantNil: true},
		{name: "empty casa", casa: "", wantNil: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := casarConta(contas, tc.casa)
			if tc.wantNil {
				if got != nil {
					t.Fatalf("expected no match, got %+v", got)
				}
				return
			}
			if got == nil || got.ID != tc.wantID {
				t.Fatalf("got %+v, want conta %s", got, tc.wantID)
			}
		})
	}
}

func TestHandleImportarPrint_TokenInvalido(t *testing.T) {
	s := New(nil, nil, Config{ExtensionToken: "segredo"})
	body := []byte(`{"imagem":"aGVsbG8="}`)
	req := httptest.NewRequest(http.MethodPost, "/api/extensao/apostas", bytes.NewReader(body))
	req.Header.Set("X-Extension-Token", "errado")
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d (body %s)", w.Code, w.Body.String())
	}
}

func TestHandleImportarPrint_SemTokenConfigurado(t *testing.T) {
	s := New(nil, nil, Config{})
	body := []byte(`{"imagem":"aGVsbG8="}`)
	req := httptest.NewRequest(http.MethodPost, "/api/extensao/apostas", bytes.NewReader(body))
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d (body %s)", w.Code, w.Body.String())
	}
}

func TestDecodificarImagem(t *testing.T) {
	raw := base64.StdEncoding.EncodeToString([]byte("fake-png-bytes"))

	t.Run("bare base64 defaults to png", func(t *testing.T) {
		data, mime, err := decodificarImagem(raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if string(data) != "fake-png-bytes" || mime != "image/png" {
			t.Fatalf("got data=%q mime=%q", data, mime)
		}
	})

	t.Run("data URL carries its own mime type", func(t *testing.T) {
		data, mime, err := decodificarImagem("data:image/jpeg;base64," + raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if string(data) != "fake-png-bytes" || mime != "image/jpeg" {
			t.Fatalf("got data=%q mime=%q", data, mime)
		}
	})

	t.Run("empty is rejected", func(t *testing.T) {
		if _, _, err := decodificarImagem(""); err == nil {
			t.Fatal("expected an error for empty input")
		}
	})

	t.Run("invalid base64 is rejected", func(t *testing.T) {
		if _, _, err := decodificarImagem("not-base64!!"); err == nil {
			t.Fatal("expected an error for invalid base64")
		}
	})
}
