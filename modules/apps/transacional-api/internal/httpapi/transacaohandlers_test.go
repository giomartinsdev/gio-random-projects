package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/transacional-api/internal/domainapi"
)

// fakeDomainAPI stands in for domain-api: GET /contas/{id} answers a
// conta ativa, POST /transacoes answers 202. Good enough to exercise
// transacional-api's own validation + wiring without a real backend.
func fakeDomainAPI(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /contas/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") == "" {
			t.Errorf("expected X-API-Key header on GET /contas/%s", r.PathValue("id"))
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(domainapi.Conta{ID: r.PathValue("id"), Status: "ativa"})
	})
	mux.HandleFunc("POST /transacoes", func(w http.ResponseWriter, r *http.Request) {
		var in domainapi.CriarInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Fatalf("decode POST /transacoes body: %v", err)
		}
		if in.UsuarioEmail == "" || in.ContaID == "" {
			t.Errorf("expected usuario_email and conta_id set, got %+v", in)
		}
		w.WriteHeader(http.StatusAccepted)
	})
	return httptest.NewServer(mux)
}

func newTestServer(domainBase string) *Server {
	return New(domainapi.New(domainBase, "test-key"), Config{})
}

func authedRequest(method, target string, body []byte) *http.Request {
	var r *http.Request
	if body != nil {
		r = httptest.NewRequest(method, target, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	return r.WithContext(WithIdentity(r.Context(), Identity{Email: "ana@example.com", Nome: "Ana"}))
}

func TestCriarTransacao_ValorInvalido_NaoChamaDomainAPI(t *testing.T) {
	called := false
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	fake := httptest.NewServer(mux)
	defer fake.Close()

	s := newTestServer(fake.URL)

	body := []byte(`{"contaId":"c1","tipo":"entrada","valor":0,"data":"2026-01-01","categoria":"salario"}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if called {
		t.Fatalf("expected domain-api to not be called for valor <= 0")
	}
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d (body %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Erro struct {
			Codigo string `json:"codigo"`
		} `json:"erro"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Erro.Codigo != "valor_invalido" {
		t.Fatalf("expected codigo valor_invalido, got %q", resp.Erro.Codigo)
	}
}

func TestCriarTransacao_Sucesso(t *testing.T) {
	fake := fakeDomainAPI(t)
	defer fake.Close()

	s := newTestServer(fake.URL)

	body := []byte(`{"contaId":"c1","tipo":"saida","valor":42.5,"data":"2026-01-01","categoria":"mercado","descricao":"compras"}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d (body %s)", w.Code, w.Body.String())
	}
}

func TestCriarTransacao_TipoInvalido(t *testing.T) {
	s := newTestServer("http://unused.invalid")
	body := []byte(`{"contaId":"c1","tipo":"transferencia","valor":10,"data":"2026-01-01","categoria":"x"}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", w.Code)
	}
}

func TestCriarTransacao_DataInvalida(t *testing.T) {
	s := newTestServer("http://unused.invalid")
	body := []byte(`{"contaId":"c1","tipo":"entrada","valor":10,"data":"01/01/2026","categoria":"x"}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", w.Code)
	}
}

func TestCriarTransacao_ContaObrigatoria(t *testing.T) {
	s := newTestServer("http://unused.invalid")
	body := []byte(`{"tipo":"entrada","valor":10,"data":"2026-01-01","categoria":"x"}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", w.Code)
	}
}

func TestCriarTransacao_ContaInvalida(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /contas/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(domainapi.Conta{ID: r.PathValue("id"), Status: "arquivada"})
	})
	fake := httptest.NewServer(mux)
	defer fake.Close()

	s := newTestServer(fake.URL)
	body := []byte(`{"contaId":"c1","tipo":"entrada","valor":10,"data":"2026-01-01","categoria":"x"}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d (body %s)", w.Code, w.Body.String())
	}
	var resp struct {
		Erro struct {
			Codigo string `json:"codigo"`
		} `json:"erro"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Erro.Codigo != "conta_invalida" {
		t.Fatalf("expected codigo conta_invalida, got %q", resp.Erro.Codigo)
	}
}

func TestCriarTransacao_AnexoMuitoGrande(t *testing.T) {
	s := newTestServer("http://unused.invalid")
	s.cfg.MaxAnexoBytes = 4 // absurdly small, any real payload trips it

	body := []byte(`{"contaId":"c1","tipo":"entrada","valor":10,"data":"2026-01-01","categoria":"x","anexoImagem":"data:image/png;base64,aGVsbG8gd29ybGQ="}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d (body %s)", w.Code, w.Body.String())
	}
}

func TestCriarTransacao_AnexoFormatoInvalido(t *testing.T) {
	s := newTestServer("http://unused.invalid")

	body := []byte(`{"contaId":"c1","tipo":"entrada","valor":10,"data":"2026-01-01","categoria":"x","anexoImagem":"data:application/pdf;base64,aGVsbG8="}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d (body %s)", w.Code, w.Body.String())
	}
}
