package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/leads-api/internal/domainapi"
)

func TestHandleCapturarLead_EmailInvalido(t *testing.T) {
	s := New(nil, Config{AllowedOrigins: []string{"https://financas.giomartins.dev"}})
	req := httptest.NewRequest(http.MethodPost, "/api/leads", bytes.NewBufferString(`{"email":"nao-e-email"}`))
	req.Header.Set("Origin", "https://financas.giomartins.dev")
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
}

func TestHandleCapturarLead_Sucesso(t *testing.T) {
	domainSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sync" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"command_id": "cmd-1", "status": "written", "entity_id": "lead-1",
		})
	}))
	defer domainSrv.Close()

	s := New(domainapi.New(domainSrv.URL, "test-key"), Config{AllowedOrigins: []string{"https://financas.giomartins.dev"}})
	req := httptest.NewRequest(http.MethodPost, "/api/leads", bytes.NewBufferString(`{"email":"ana@exemplo.com"}`))
	req.Header.Set("Origin", "https://financas.giomartins.dev")
	rec := httptest.NewRecorder()

	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201, body=%s", rec.Code, rec.Body.String())
	}
}

func TestRateLimiter(t *testing.T) {
	l := newIPRateLimiter(2, time.Minute)
	if !l.allow("1.2.3.4") || !l.allow("1.2.3.4") {
		t.Fatal("expected first two requests to be allowed")
	}
	if l.allow("1.2.3.4") {
		t.Fatal("expected third request to be blocked")
	}
	if !l.allow("5.6.7.8") {
		t.Fatal("a different IP must not be affected by another IP's limit")
	}
}
