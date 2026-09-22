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
	"time"
)

// stubAudits answers CommandOutcome from a canned outcome; calls counts
// how many polls the sync loop made.
type stubAudits struct {
	found, success bool
	detail         string
	err            error
	calls          int
}

func (s *stubAudits) CommandOutcome(_ context.Context, _ string) (found, success bool, detail string, err error) {
	s.calls++
	return s.found, s.success, s.detail, s.err
}

func newSyncServer(t *testing.T, publisher *spyPublisher, audits *stubAudits) http.Handler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewRouter(
		NewHandlers(nil, publisher, log),
		NewPostHandlers(nil, publisher, log),
		NewRoomHandlers(nil, publisher, log),
		NewMessageHandlers(nil, publisher, log),
		NewDealHandlers(nil, publisher, log),
		NewSSEHandlers(nil, log),
		NewCCHHandlers(nil, nil, publisher, log),
		NewSyncHandlers(publisher, audits, log),
		NewContaHandlers(nil, log),
		NewTransacaoHandlers(nil, publisher, log),
		NewAtivoHandlers(nil, nil, publisher, log),
		NewApostaHandlers(nil, log),
		NewDashboardLayoutHandlers(nil, log),
		// nil repos/handlers: these tests never touch the clubs routes, they
		// only need them registered on the router.
		NewClubsHandlers(nil, log),
		NewClubsWriteHandlers(publisher, log),
		APIKeys{"k1": "test"},
		NewIPRateLimiter(1000, 1000),
		log,
	)
}

func postSync(handler http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/sync", strings.NewReader(body))
	req.Header.Set("X-API-Key", "k1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestSyncRejectsInvalidEnvelope(t *testing.T) {
	handler := newSyncServer(t, &spyPublisher{}, &stubAudits{})

	for name, body := range map[string]string{
		"invalid json":   `{`,
		"missing action": `{"payload":{}}`,
		"empty body":     ``,
	} {
		t.Run(name, func(t *testing.T) {
			if rec := postSync(handler, body); rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s; want 400", rec.Code, rec.Body)
			}
		})
	}
}

func TestSyncWritten(t *testing.T) {
	savedInterval, savedTimeout := syncPollInterval, syncTimeout
	syncPollInterval, syncTimeout = time.Millisecond, 50*time.Millisecond
	defer func() { syncPollInterval, syncTimeout = savedInterval, savedTimeout }()

	// The audit row shows up on the second poll — the loop must keep
	// asking until it does.
	audits := &stubAudits{found: true, success: true, detail: "room-1"}
	pub := &spyPublisher{}
	handler := newSyncServer(t, pub, audits)

	rec := postSync(handler, `{"action":"cchroom.create","payload":{"id":"room-1"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s; want 200", rec.Code, rec.Body)
	}
	var resp syncBody
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if resp.Status != "written" || resp.EntityID != "room-1" || resp.CommandID == "" {
		t.Fatalf("body = %+v", resp)
	}
	// The published command carries the server-generated id the poll
	// used — not any id the client sent (there was none here, but the
	// contract is overwrite, not trust).
	if pub.cmd.ID != resp.CommandID {
		t.Fatalf("polled id %q != published id %q", resp.CommandID, pub.cmd.ID)
	}
	if string(pub.cmd.Action) != "cchroom.create" {
		t.Fatalf("action = %q", pub.cmd.Action)
	}
}

func TestSyncFailedSurfacesWorkerError(t *testing.T) {
	savedInterval, savedTimeout := syncPollInterval, syncTimeout
	syncPollInterval, syncTimeout = time.Millisecond, 50*time.Millisecond
	defer func() { syncPollInterval, syncTimeout = savedInterval, savedTimeout }()

	audits := &stubAudits{found: true, success: false, detail: "salt is required"}
	handler := newSyncServer(t, &spyPublisher{}, audits)

	rec := postSync(handler, `{"action":"cchroom.create","payload":{}}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, body = %s; want 422", rec.Code, rec.Body)
	}
	var resp syncBody
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if resp.Status != "failed" || resp.Error != "salt is required" {
		t.Fatalf("body = %+v", resp)
	}
}

func TestSyncQueuedOnTimeout(t *testing.T) {
	savedInterval, savedTimeout := syncPollInterval, syncTimeout
	syncPollInterval, syncTimeout = time.Millisecond, 15*time.Millisecond
	defer func() { syncPollInterval, syncTimeout = savedInterval, savedTimeout }()

	// Never found: the worker is down/slow. The command was still
	// published, so the answer is 504 "queued", not 422 "failed".
	audits := &stubAudits{}
	handler := newSyncServer(t, &spyPublisher{}, audits)

	rec := postSync(handler, `{"action":"cchroom.create","payload":{"id":"room-1"}}`)
	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("status = %d, body = %s; want 504", rec.Code, rec.Body)
	}
	var resp syncBody
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if resp.Status != "queued" {
		t.Fatalf("status field = %q; want queued", resp.Status)
	}
	if audits.calls == 0 {
		t.Fatal("audit_log was never polled")
	}
}

func TestSyncKeepsPollingThroughAuditErrors(t *testing.T) {
	savedInterval, savedTimeout := syncPollInterval, syncTimeout
	syncPollInterval, syncTimeout = time.Millisecond, 50*time.Millisecond
	defer func() { syncPollInterval, syncTimeout = savedInterval, savedTimeout }()

	// Transient Postgres read error, then success: the route must not
	// answer 422 off a read hiccup.
	audits := &stubAudits{err: io.ErrUnexpectedEOF}
	handler := newSyncServer(t, &spyPublisher{}, audits)
	go func() {
		time.Sleep(5 * time.Millisecond)
		audits.err = nil
		audits.found, audits.success, audits.detail = true, true, "room-1"
	}()

	rec := postSync(handler, `{"action":"cchdeck.upsert","payload":{"id":"d1"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s; want 200 after transient error cleared", rec.Code, rec.Body)
	}
}