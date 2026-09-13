package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/contas-api/internal/domainapi"
)

// fakeDomainAPI stands in for domain-api's /sync route: it decodes the
// envelope, inspects the action/payload, and answers exactly like the
// worker would for the two cases the test cares about (a valid
// conta.create and one the worker rejects for an invalid tipo).
func fakeDomainAPI(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "test-key" {
			t.Fatalf("expected X-API-Key header, got %q", r.Header.Get("X-API-Key"))
		}
		if r.URL.Path != "/sync" {
			t.Fatalf("expected POST /sync, got %s", r.URL.Path)
		}
		var env struct {
			Action  string               `json:"action"`
			Payload domainapi.CriarInput `json:"payload"`
		}
		if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
			t.Fatalf("decode envelope: %v", err)
		}
		if env.Action != "conta.create" {
			t.Fatalf("expected action conta.create, got %s", env.Action)
		}

		w.Header().Set("Content-Type", "application/json")
		switch env.Payload.Tipo {
		case "corrente", "investimento":
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"command_id": "cmd-1",
				"status":     "written",
				"entity_id":  "conta-1",
			})
		default:
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"command_id": "cmd-2",
				"status":     "failed",
				"error":      "tipo inválido",
			})
		}
	}))
}

func newTestServer(t *testing.T, domainURL string) *Server {
	t.Helper()
	client := domainapi.New(domainURL, "test-key")
	return New(client, Config{})
}

func withIdentity(r *http.Request, email string) *http.Request {
	return r.WithContext(WithIdentity(r.Context(), Identity{Email: email, Nome: "Test"}))
}

func TestHandleCriarConta_Sucesso(t *testing.T) {
	fake := fakeDomainAPI(t)
	defer fake.Close()
	s := newTestServer(t, fake.URL)

	body := strings.NewReader(`{"nome":"Conta Corrente","tipo":"corrente"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/contas", body)
	req = withIdentity(req, "gio@corp")
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["id"] != "conta-1" {
		t.Fatalf("expected id conta-1, got %v", resp["id"])
	}
}

func TestHandleCriarConta_TipoInvalido(t *testing.T) {
	fake := fakeDomainAPI(t)
	defer fake.Close()
	s := newTestServer(t, fake.URL)

	body := strings.NewReader(`{"nome":"Conta Estranha","tipo":"cripto"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/contas", body)
	req = withIdentity(req, "gio@corp")
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleCriarConta_NomeVazio(t *testing.T) {
	fake := fakeDomainAPI(t)
	defer fake.Close()
	s := newTestServer(t, fake.URL)

	body := strings.NewReader(`{"nome":"","tipo":"corrente"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/contas", body)
	req = withIdentity(req, "gio@corp")
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleHealth_SemAuth(t *testing.T) {
	s := newTestServer(t, "http://127.0.0.1:0")

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

// saldoFake is what a /saldo request's reads return: the conta itself,
// its transações (corrente branch) and/or its posições (investimento).
type saldoFake struct {
	conta      domainapi.Conta
	transacoes []domainapi.Transacao
	ativos     []domainapi.Ativo
	notFound   bool
}

// fakeDomainSaldo serves the three GETs handleSaldoConta reads, pinning
// the query params (usuario/conta must scope every read) and the
// X-API-Key header along the way.
func fakeDomainSaldo(t *testing.T, f saldoFake) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /contas/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "test-key" {
			t.Fatalf("expected X-API-Key header, got %q", r.Header.Get("X-API-Key"))
		}
		w.Header().Set("Content-Type", "application/json")
		if f.notFound {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(f.conta)
	})
	mux.HandleFunc("GET /transacoes", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("usuario") == "" || r.URL.Query().Get("conta") == "" {
			t.Fatalf("expected usuario and conta query params, got %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"transacoes": f.transacoes})
	})
	mux.HandleFunc("GET /ativos", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("usuario") == "" || r.URL.Query().Get("conta") == "" {
			t.Fatalf("expected usuario and conta query params, got %s", r.URL.RawQuery)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ativos": f.ativos})
	})
	return httptest.NewServer(mux)
}

func saldoDe(t *testing.T, f saldoFake, email string) *httptest.ResponseRecorder {
	t.Helper()
	fake := fakeDomainSaldo(t, f)
	defer fake.Close()
	s := newTestServer(t, fake.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/contas/c1/saldo", nil)
	req = withIdentity(req, email)
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)
	return rec
}

// TestSaldoConta_Corrente: entradas − saídas over the conta's
// transações, read straight from domain-api. This is the number both
// the dashboard's saldo-consolidado and the Contas page render --
// before this, /saldo was a placeholder with no saldo field, so every
// conta rendered R$ 0.
func TestSaldoConta_Corrente(t *testing.T) {
	rec := saldoDe(t, saldoFake{
		conta: domainapi.Conta{ID: "c1", Tipo: "corrente", Usuario: "gio@corp"},
		transacoes: []domainapi.Transacao{
			{Tipo: "entrada", Valor: 150},
			{Tipo: "entrada", Valor: 30},
			{Tipo: "saida", Valor: 80},
		},
	}, "gio@corp")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		ContaID string  `json:"contaId"`
		Saldo   float64 `json:"saldo"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.ContaID != "c1" {
		t.Fatalf("expected contaId c1, got %q", resp.ContaID)
	}
	if resp.Saldo != 100 {
		t.Fatalf("expected saldo 100 (150+30-80), got %v", resp.Saldo)
	}
}

// TestSaldoConta_Investimento: Σ quantidade × cotação, with the custo
// médio fallback for a position whose quote was never fetched
// (ultima_cotacao zero) -- otherwise a freshly created ativo would
// count as zero until brapi.dev answered once.
func TestSaldoConta_Investimento(t *testing.T) {
	rec := saldoDe(t, saldoFake{
		conta: domainapi.Conta{ID: "c1", Tipo: "investimento", Usuario: "gio@corp"},
		ativos: []domainapi.Ativo{
			{QuantidadeAtual: 10, CustoMedio: 30, UltimaCotacao: 45},
			{QuantidadeAtual: 2, CustoMedio: 100, UltimaCotacao: 0},
		},
	}, "gio@corp")

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Saldo float64 `json:"saldo"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Saldo != 650 { // 10*45 + 2*100 (custo médio fallback)
		t.Fatalf("expected saldo 650, got %v", resp.Saldo)
	}
}

// TestSaldoConta_ContadeOutraPessoa: a stranger's contaId must answer
// exactly like a nonexistent one -- no existence oracle.
func TestSaldoConta_ContadeOutraPessoa(t *testing.T) {
	rec := saldoDe(t, saldoFake{
		conta: domainapi.Conta{ID: "c1", Tipo: "corrente", Usuario: "outra@corp"},
	}, "gio@corp")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSaldoConta_Inexistente(t *testing.T) {
	rec := saldoDe(t, saldoFake{
		conta:    domainapi.Conta{ID: "c1", Tipo: "corrente", Usuario: "gio@corp"},
		notFound: true,
	}, "gio@corp")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestSaldoConta_DomainFora: a domain-api transport failure is a 502,
// not a 404 -- the caller didn't do anything wrong.
func TestSaldoConta_DomainFora(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer fake.Close()
	s := newTestServer(t, fake.URL)

	req := httptest.NewRequest(http.MethodGet, "/api/contas/c1/saldo", nil)
	req = withIdentity(req, "gio@corp")
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rec.Code, rec.Body.String())
	}
}
