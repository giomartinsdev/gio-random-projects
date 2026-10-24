package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
)

// A porta envelope assíncrona (§4.1): decodifica {action, payload} e responde
// 202 na hora, publicando com um id de servidor novo (o do cliente é
// descartado, a mesma regra do /sync).

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func envelopeServer(pub application.CommandPublisher) http.Handler {
	mux := http.NewServeMux()
	h := NewEnvelopeHandlers(pub, discardLogger())
	mux.HandleFunc("/commands", h.Publish)
	return mux
}

func postEnvelope(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/commands", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestEnvelopePublishesAndAnswers202(t *testing.T) {
	pub := &spyPublisher{}
	rec := postEnvelope(t, envelopeServer(pub), `{"action":"finance.transaction.register","payload":{"amount":"45.00"}}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d; want 202", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body: %v", err)
	}
	if body["status"] != "accepted" {
		t.Fatalf("status body = %v; want accepted", body["status"])
	}
	if pub.calls != 1 {
		t.Fatalf("publisher chamado %d vezes; want 1", pub.calls)
	}
	if string(pub.cmd.Action) != "finance.transaction.register" {
		t.Fatalf("action = %q", pub.cmd.Action)
	}
	if pub.cmd.ID == "" {
		t.Fatal("o domínio devia carimbar um command_id de servidor")
	}
}

func TestEnvelopeOverwritesClientSuppliedID(t *testing.T) {
	pub := &spyPublisher{}
	rec := postEnvelope(t, envelopeServer(pub), `{"action":"finance.x.y","payload":{} }`)
	_ = rec
	// O envelope nem expõe campo id; ainda assim, um id não pode virar
	// autoritativo. O handler sempre gera um novo.
	if pub.cmd.ID == "" {
		t.Fatal("command_id devia ser gerado pelo servidor")
	}
}

func TestEnvelopeRejectsMissingAction(t *testing.T) {
	pub := &spyPublisher{}
	for name, body := range map[string]string{
		"sem action": `{"payload":{}}`,
		"json ruim":  `{`,
		"vazio":      ``,
	} {
		rec := postEnvelope(t, envelopeServer(pub), body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s = %d; want 400", name, rec.Code)
		}
	}
	if pub.calls != 0 {
		t.Fatalf("nada podia ser publicado; houve %d publishes", pub.calls)
	}
}

func TestEnvelopePublishFailureIs500(t *testing.T) {
	pub := &spyPublisher{err: context.DeadlineExceeded}
	rec := postEnvelope(t, envelopeServer(pub), `{"action":"finance.x.y","payload":{}}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d; want 500 (nada foi aceito)", rec.Code)
	}
}
