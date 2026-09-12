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
