package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/dashboard-api/internal/domainapi"
)

// newTestServer builds a Server against a fake domain-api and injects an
// already-authenticated identity, mirroring how auth.go's own comment
// says tests should skip the middleware.
func newTestServer(domainBase string) *Server {
	domain := domainapi.New(domainBase, "test-key")
	return New(domain, Config{})
}

func doRequest(t *testing.T, s *Server, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req = req.WithContext(WithIdentity(req.Context(), Identity{Email: "ana@example.com", Nome: "Ana"}))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

// TestPutLayout_TipoVisualizacaoInvalido asserts a bloco with an
// unknown tipoVisualizacao is rejected 422 with the documented code,
// and — critically — never reaches domain-api: the fake server below
// fails the test if it receives any request at all.
func TestPutLayout_TipoVisualizacaoInvalido(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("domain-api should not have been called, got %s %s", r.Method, r.URL.Path)
	}))
	defer fake.Close()

	s := newTestServer(fake.URL)

	body := `{"blocos":[{"id":"b1","tipoVisualizacao":"grafico3d","posicao":{"x":0,"y":0},"tamanho":{"largura":1,"altura":1},"fonteDados":{"conta":"c1"}}]}`
	rec := doRequest(t, s, http.MethodPut, "/api/layout", body)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Erro struct {
			Codigo string `json:"codigo"`
		} `json:"erro"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Erro.Codigo != "tipo_visualizacao_invalido" {
		t.Fatalf("codigo = %q, want tipo_visualizacao_invalido", resp.Erro.Codigo)
	}
}

// TestPutLayout_Valido exercises the happy path against a fake /sync
// endpoint, asserting the envelope dashboard-api sends matches the
// fixed contract (action dashboardlayout.save, usuario_email + blocos
// passed through).
func TestPutLayout_Valido(t *testing.T) {
	var gotBody []byte
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sync" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		var err error
		gotBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"command_id":"c1","status":"written","entity_id":"ana@example.com"}`))
	}))
	defer fake.Close()

	s := newTestServer(fake.URL)

	body := `{"blocos":[{"id":"b1","tipoVisualizacao":"indicador","posicao":{"x":0,"y":0},"tamanho":{"largura":2,"altura":2},"fonteDados":{"conta":"c1"}}]}`
	rec := doRequest(t, s, http.MethodPut, "/api/layout", body)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var envelope struct {
		Action  string `json:"action"`
		Payload struct {
			UsuarioEmail string          `json:"usuario_email"`
			Blocos       json.RawMessage `json:"blocos"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(gotBody, &envelope); err != nil {
		t.Fatalf("decode envelope sent to domain-api: %v", err)
	}
	if envelope.Action != "dashboardlayout.save" {
		t.Fatalf("action = %q, want dashboardlayout.save", envelope.Action)
	}
	if envelope.Payload.UsuarioEmail != "ana@example.com" {
		t.Fatalf("usuario_email = %q, want ana@example.com", envelope.Payload.UsuarioEmail)
	}
	if len(envelope.Payload.Blocos) == 0 {
		t.Fatalf("blocos was not forwarded")
	}
}
