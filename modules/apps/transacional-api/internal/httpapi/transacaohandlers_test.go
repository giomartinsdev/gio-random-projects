package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
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

// TestCriarTransacao_DataEnviadaRFC3339 pins the wire format: the
// date-only "data" the frontend contract speaks used to reach
// domain-api raw, whose time.Time decode answered 400 -- surfaced to
// the frontend as a 502. valor has the same story: a JSON string where
// domain-api's float64 decode expects a number. The payload must leave
// as RFC3339 + numeric valor.
func TestCriarTransacao_DataEnviadaRFC3339(t *testing.T) {
	var got domainapi.CriarInput
	mux := http.NewServeMux()
	mux.HandleFunc("GET /contas/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(domainapi.Conta{ID: r.PathValue("id"), Status: "ativa"})
	})
	mux.HandleFunc("POST /transacoes", func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode POST /transacoes body: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
	})
	fake := httptest.NewServer(mux)
	defer fake.Close()

	s := newTestServer(fake.URL)
	body := []byte(`{"contaId":"c1","tipo":"entrada","valor":123.45,"data":"2026-09-12","categoria":"x"}`)
	req := authedRequest(http.MethodPost, "/api/transacoes", body)
	w := httptest.NewRecorder()

	s.handleCriarTransacao(w, req)

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d (body %s)", w.Code, w.Body.String())
	}
	if got.Valor != 123.45 {
		t.Fatalf("expected numeric valor 123.45 on the wire, got %v", got.Valor)
	}
	if got.Data != "2026-09-12T00:00:00Z" {
		t.Fatalf("expected RFC3339 data on the wire, got %q", got.Data)
	}
}

// Same contract for the edit path, which forwards a pointer. Served
// through a mux because r.PathValue("id") only resolves on a route
// match -- calling the handler directly leaves it empty.
func TestEditarTransacao_DataEnviadaRFC3339(t *testing.T) {
	var got domainapi.EditarInput
	mux := http.NewServeMux()
	mux.HandleFunc("PATCH /transacoes/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode PATCH /transacoes body: %v", err)
		}
		w.WriteHeader(http.StatusAccepted)
	})
	fake := httptest.NewServer(mux)
	defer fake.Close()

	s := newTestServer(fake.URL)
	srvMux := http.NewServeMux()
	srvMux.HandleFunc("PATCH /api/transacoes/{id}", s.handleEditarTransacao)
	srv := httptest.NewServer(srvMux)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodPatch, srv.URL+"/api/transacoes/t1",
		bytes.NewReader([]byte(`{"data":"2026-09-12"}`)))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusAccepted {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("expected 202, got %d (body %s)", res.StatusCode, b)
	}
	if got.Data == nil || *got.Data != "2026-09-12T00:00:00Z" {
		t.Fatalf("expected RFC3339 data on the wire, got %v", got.Data)
	}
}
