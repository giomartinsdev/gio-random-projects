package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/domainapi"
)

// fakeDomainSync answers POST /sync with "written" and captures the
// envelope so tests can pin exactly what reaches domain-worker. Only
// these routes are needed: criar ativo and registrar movimento are both
// /sync writes (see internal/domainapi/client.go).
func fakeDomainSync(t *testing.T) (*httptest.Server, *[]capturedEnvelope) {
	t.Helper()
	captured := &[]capturedEnvelope{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /sync", func(w http.ResponseWriter, r *http.Request) {
		var env capturedEnvelope
		if err := json.NewDecoder(r.Body).Decode(&env); err != nil {
			t.Fatalf("decode /sync body: %v", err)
		}
		*captured = append(*captured, env)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"command_id":"c1","status":"written","entity_id":"a1"}`))
	})
	return httptest.NewServer(mux), captured
}

type capturedEnvelope struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
}

// authedRequest builds a request as an already-authenticated person,
// skipping the middleware the same way transacional-api's tests do.
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

// TestCriarAtivo_DataEnviadaRFC3339 pins the wire format: the date-only
// "data" the frontend contract speaks used to reach the domain-worker's
// time.Time decode raw, which rejected the command -- the 422 the
// frontend saw ("parsing time \"...\" as ... cannot parse \"\" as
// \"T\""). The payload must leave this BFF as RFC3339.
func TestCriarAtivo_DataEnviadaRFC3339(t *testing.T) {
	fake, captured := fakeDomainSync(t)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), nil, Config{})

	body := []byte(`{"contaId":"c1","ticker":"PETR4","quantidade":10,"precoUnitario":38.5,"data":"2026-09-12"}`)
	req := authedRequest(http.MethodPost, "/api/ativos", body)
	w := httptest.NewRecorder()

	s.handleCreateAtivo(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body %s)", w.Code, w.Body.String())
	}
	if len(*captured) != 1 {
		t.Fatalf("expected exactly one /sync call, got %d", len(*captured))
	}
	if (*captured)[0].Action != "ativo.create" {
		t.Fatalf("expected action ativo.create, got %q", (*captured)[0].Action)
	}
	var payload struct {
		Quantidade float64 `json:"quantidade_inicial"`
		Data       string  `json:"data"`
	}
	if err := json.Unmarshal((*captured)[0].Payload, &payload); err != nil {
		t.Fatalf("decode captured payload: %v", err)
	}
	// The worker's command field is quantidade_inicial; a "quantidade"
	// tag here decoded as zero and the create was rejected.
	if payload.Quantidade != 10 {
		t.Fatalf("expected quantidade_inicial 10 on the wire, got %v", payload.Quantidade)
	}
	if payload.Data != "2026-09-12T00:00:00Z" {
		t.Fatalf("expected RFC3339 data on the wire, got %q", payload.Data)
	}
}

// TestCriarAtivo_DataInvalida: a malformed date must be a clean 422
// from this BFF's own validation, not the worker's decode error.
func TestCriarAtivo_DataInvalida(t *testing.T) {
	fake, captured := fakeDomainSync(t)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), nil, Config{})

	body := []byte(`{"contaId":"c1","ticker":"PETR4","quantidade":10,"precoUnitario":38.5,"data":"12/09/2026"}`)
	req := authedRequest(http.MethodPost, "/api/ativos", body)
	w := httptest.NewRecorder()

	s.handleCreateAtivo(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d (body %s)", w.Code, w.Body.String())
	}
	if len(*captured) != 0 {
		t.Fatalf("expected no /sync call for an invalid date, got %d", len(*captured))
	}
}

// TestRegistrarMovimento_DataEnviadaRFC3339: same contract for the
// movement path (compra/venda/provento). Served through a mux because
// r.PathValue("id") only resolves on a route match.
func TestRegistrarMovimento_DataEnviadaRFC3339(t *testing.T) {
	fake, captured := fakeDomainSync(t)
	defer fake.Close()

	s := New(domainapi.New(fake.URL, "test-key"), nil, Config{})
	srvMux := http.NewServeMux()
	srvMux.HandleFunc("POST /api/ativos/{id}/movimentos", s.handleRegisterMovimento)
	srv := httptest.NewServer(srvMux)
	defer srv.Close()

	req, err := http.NewRequest(http.MethodPost, srv.URL+"/api/ativos/a1/movimentos",
		bytes.NewReader([]byte(`{"tipo":"compra","quantidade":5,"precoUnitario":40,"data":"2026-09-12"}`)))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("expected 201, got %d (body %s)", res.StatusCode, b)
	}
	if len(*captured) != 1 {
		t.Fatalf("expected exactly one /sync call, got %d", len(*captured))
	}
	if (*captured)[0].Action != "ativo.registerMovement" {
		t.Fatalf("expected action ativo.registerMovement, got %q", (*captured)[0].Action)
	}
	var payload struct {
		AtivoID string `json:"ativo_id"`
		Data    string `json:"data"`
	}
	if err := json.Unmarshal((*captured)[0].Payload, &payload); err != nil {
		t.Fatalf("decode captured payload: %v", err)
	}
	if payload.AtivoID != "a1" {
		t.Fatalf("expected ativo_id a1 on the wire, got %q", payload.AtivoID)
	}
	if payload.Data != "2026-09-12T00:00:00Z" {
		t.Fatalf("expected RFC3339 data on the wire, got %q", payload.Data)
	}
}
