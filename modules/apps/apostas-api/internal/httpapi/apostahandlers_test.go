package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-api/internal/domainapi"
)

type capturedSync struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
}

// fakeDomain answers GET /contas/{id} (a live "aposta" conta owned by
// ana@example.com), POST /sync (aposta.registrar/aposta.resolver) and
// POST /transacoes (the async money movement), capturing every call so
// tests can pin the exact sequence.
func fakeDomain(t *testing.T) (*httptest.Server, *[]capturedSync, *[]domainapi.CriarTransacaoInput) {
	t.Helper()
	syncCalls := &[]capturedSync{}
	txCalls := &[]domainapi.CriarTransacaoInput{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /contas/{id}", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(domainapi.Conta{
			ID: r.PathValue("id"), UsuarioEmail: "ana@example.com", Tipo: "aposta", Status: "ativa",
		})
	})
	mux.HandleFunc("GET /apostas/{id}", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(domainapi.Aposta{
			ID: r.PathValue("id"), UsuarioEmail: "ana@example.com", ContaID: "conta-1",
			Descricao: "Real Madrid vence", ValorApostado: 100, Status: "pendente",
		})
	})
	mux.HandleFunc("POST /sync", func(w http.ResponseWriter, r *http.Request) {
		var env capturedSync
		if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
			t.Fatalf("decode /sync body: %v", err)
		}
		*syncCalls = append(*syncCalls, env)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"command_id":"c1","status":"written","entity_id":"aposta-1"}`))
	})
	mux.HandleFunc("POST /transacoes", func(w http.ResponseWriter, r *http.Request) {
		var in domainapi.CriarTransacaoInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Fatalf("decode /transacoes body: %v", err)
		}
		*txCalls = append(*txCalls, in)
		w.WriteHeader(http.StatusAccepted)
	})
	return httptest.NewServer(mux), syncCalls, txCalls
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

func TestRegistrarAposta_DebitaAposRegistrar(t *testing.T) {
	fake, syncCalls, txCalls := fakeDomain(t)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), Config{})
	body := []byte(`{"contaId":"conta-1","descricao":"Real Madrid vence","valorApostado":100,"odd":1.8,"dataAposta":"2026-09-01"}`)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, authedRequest(http.MethodPost, "/api/apostas", body))

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body %s)", w.Code, w.Body.String())
	}
	if len(*syncCalls) != 1 || (*syncCalls)[0].Action != "aposta.registrar" {
		t.Fatalf("expected 1 aposta.registrar sync call, got %+v", *syncCalls)
	}
	if len(*txCalls) != 1 || (*txCalls)[0].Tipo != "saida" || (*txCalls)[0].Valor != 100 {
		t.Fatalf("expected 1 saida transacao of 100, got %+v", *txCalls)
	}
}

func TestRegistrarAposta_RejeitaContaDeOutroTipo(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /contas/{id}", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(domainapi.Conta{
			ID: r.PathValue("id"), UsuarioEmail: "ana@example.com", Tipo: "corrente", Status: "ativa",
		})
	})
	fake := httptest.NewServer(mux)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), Config{})
	body := []byte(`{"contaId":"conta-1","descricao":"Real Madrid vence","valorApostado":100,"dataAposta":"2026-09-01"}`)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, authedRequest(http.MethodPost, "/api/apostas", body))

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d (body %s)", w.Code, w.Body.String())
	}
}

func TestRegistrarAposta_ValidaCampos(t *testing.T) {
	s := New(domainapi.New("http://unused", "k"), Config{})
	body := []byte(`{"contaId":"","descricao":"","valorApostado":0,"dataAposta":""}`)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, authedRequest(http.MethodPost, "/api/apostas", body))

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d (body %s)", w.Code, w.Body.String())
	}
}

func TestResolverAposta_GreenCreditaRetorno(t *testing.T) {
	fake, syncCalls, txCalls := fakeDomain(t)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), Config{})
	body := []byte(`{"status":"green","retornoObtido":180,"dataResultado":"2026-09-02"}`)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, authedRequest(http.MethodPatch, "/api/apostas/aposta-1/resolver", body))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body %s)", w.Code, w.Body.String())
	}
	if len(*syncCalls) != 1 || (*syncCalls)[0].Action != "aposta.resolver" {
		t.Fatalf("expected 1 aposta.resolver sync call, got %+v", *syncCalls)
	}
	if len(*txCalls) != 1 || (*txCalls)[0].Tipo != "entrada" || (*txCalls)[0].Valor != 180 {
		t.Fatalf("expected 1 entrada transacao of 180, got %+v", *txCalls)
	}
}

func TestResolverAposta_RedNaoCriaTransacao(t *testing.T) {
	fake, syncCalls, txCalls := fakeDomain(t)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), Config{})
	body := []byte(`{"status":"red","dataResultado":"2026-09-02"}`)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, authedRequest(http.MethodPatch, "/api/apostas/aposta-1/resolver", body))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body %s)", w.Code, w.Body.String())
	}
	if len(*syncCalls) != 1 {
		t.Fatalf("expected 1 aposta.resolver sync call, got %+v", *syncCalls)
	}
	if len(*txCalls) != 0 {
		t.Fatalf("expected no transacao for a red result, got %+v", *txCalls)
	}
}

func TestResolverAposta_CanceladaReembolsaValorApostado(t *testing.T) {
	fake, _, txCalls := fakeDomain(t)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), Config{})
	body := []byte(`{"status":"cancelada","dataResultado":"2026-09-02"}`)
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, authedRequest(http.MethodPatch, "/api/apostas/aposta-1/resolver", body))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body %s)", w.Code, w.Body.String())
	}
	if len(*txCalls) != 1 || (*txCalls)[0].Valor != 100 {
		t.Fatalf("expected refund transacao of 100 (o valor apostado), got %+v", *txCalls)
	}
}
