package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appdeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/deal"
	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/deal"
)

// spyPublisher records the last command it was handed.
type spyPublisher struct {
	cmd   application.Command
	err   error
	calls int
}

func (s *spyPublisher) Publish(_ context.Context, cmd application.Command) error {
	s.calls++
	s.cmd = cmd
	return s.err
}

// stubDeals answers the read endpoints from a canned list.
type stubDeals struct {
	byKey  map[string]domaindeal.Deal
	recent []domaindeal.Deal
	err    error
}

func (s *stubDeals) FindByKey(_ context.Context, source, id string) (domaindeal.Deal, error) {
	if s.byKey != nil {
		if d, ok := s.byKey[source+":"+id]; ok {
			return d, nil
		}
	}
	return domaindeal.Deal{}, domaindeal.ErrNotFound
}

func (s *stubDeals) ListRecent(_ context.Context, _ string, limit int) ([]domaindeal.Deal, error) {
	if s.err != nil {
		return nil, s.err
	}
	if limit < len(s.recent) {
		return s.recent[:limit], nil
	}
	return s.recent, nil
}

func newDealServer(t *testing.T, deals domaindeal.Repository, publisher *spyPublisher) http.Handler {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewRouter(
		NewHandlers(nil, publisher, log),
		NewPostHandlers(nil, publisher, log),
		NewRoomHandlers(nil, publisher, log),
		NewMessageHandlers(nil, publisher, log),
		NewDealHandlers(deals, publisher, log),
		NewSSEHandlers(nil, log),
		APIKeys{"k1": "test"},
		NewIPRateLimiter(1000, 1000),
		log,
	)
}

func postDeals(handler http.Handler, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/deals", strings.NewReader(body))
	req.Header.Set("X-API-Key", "k1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func TestCreateDealRejectsIncompleteInput(t *testing.T) {
	cases := []struct{ name, body string }{
		{"missing source", `{"source_deal_id":"1","title":"t","url":"https://e.com/x"}`},
		{"missing source_deal_id", `{"source":"pld","title":"t","url":"https://e.com/x"}`},
		{"missing title", `{"source":"pld","source_deal_id":"1","url":"https://e.com/x"}`},
		{"missing url", `{"source":"pld","source_deal_id":"1","title":"t"}`},
		{"invalid json", `{`},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			pub := &spyPublisher{}
			handler := newDealServer(t, &stubDeals{}, pub)

			if rec := postDeals(handler, tt.body); rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, body = %s; want 400", rec.Code, rec.Body)
			}
			if pub.calls != 0 {
				t.Fatalf("invalid input reached the command bus %d times", pub.calls)
			}
		})
	}
}

func TestCreateDealPublishesUpsertVerbatim(t *testing.T) {
	pub := &spyPublisher{}
	handler := newDealServer(t, &stubDeals{}, pub)

	body := `{"source":"phb","source_deal_id":"x123","title":"Headset","url":"https://example.com/h","price_cents":19999,"payload":{"verbatim":"keep","me":true}}`
	if rec := postDeals(handler, body); rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s; want 202", rec.Code, rec.Body)
	}

	if pub.cmd.Action != application.ActionUpsertDeal {
		t.Fatalf("action = %q", pub.cmd.Action)
	}
	var in appdeal.UpsertInput
	if err := json.Unmarshal(pub.cmd.Payload, &in); err != nil {
		t.Fatalf("unmarshal command payload: %v", err)
	}
	if in.Source != "phb" || in.SourceDealID != "x123" || in.Title != "Headset" {
		t.Fatalf("input = %+v", in)
	}
	// The source's own JSON must survive the round-trip through the
	// command's payload untouched — that's the whole point of payload.
	if !strings.Contains(string(in.Payload), `"verbatim":"keep"`) {
		t.Fatalf("payload = %s; verbatim JSON lost", in.Payload)
	}
}

func TestCreateDealAcceptedShape(t *testing.T) {
	pub := &spyPublisher{}
	handler := newDealServer(t, &stubDeals{}, pub)

	rec := postDeals(handler, `{"source":"pld","source_deal_id":"9","title":"t","url":"https://e.com/9"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d; want 202", rec.Code)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode 202 body: %v", err)
	}
	if resp["status"] != "accepted" {
		t.Fatalf("status field = %v", resp["status"])
	}
	if resp["command_id"] == "" {
		t.Fatal("command_id missing from 202 body")
	}
}

func TestListDealsClampsLimit(t *testing.T) {
	stub := &stubDeals{recent: []domaindeal.Deal{{Source: "pld", Title: "a"}, {Source: "phb", Title: "b"}}}
	handler := newDealServer(t, stub, &spyPublisher{})

	for _, tc := range []struct {
		query string
		want  int
	}{
		{"", 2},           // default 50 > 2 items → both
		{"?limit=1", 1},   // explicit
		{"?limit=500", 2}, // clamped to 200, still > 2 items
	} {
		req := httptest.NewRequest(http.MethodGet, "/deals"+tc.query, nil)
		req.Header.Set("X-API-Key", "k1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("query %q: status = %d", tc.query, rec.Code)
		}
		var resp struct {
			Deals []json.RawMessage `json:"deals"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("query %q: decode: %v", tc.query, err)
		}
		if len(resp.Deals) != tc.want {
			t.Fatalf("query %q: got %d deals, want %d", tc.query, len(resp.Deals), tc.want)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/deals?limit=0", nil)
	req.Header.Set("X-API-Key", "k1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("limit=0: status = %d; want 400", rec.Code)
	}
}

func TestListDealsMapsNullsNotAbsent(t *testing.T) {
	stub := &stubDeals{recent: []domaindeal.Deal{{Source: "pld", SourceDealID: "1", Title: "t", URL: "u", ScrapedAt: time.Now().UTC()}}}
	handler := newDealServer(t, stub, &spyPublisher{})

	req := httptest.NewRequest(http.MethodGet, "/deals", nil)
	req.Header.Set("X-API-Key", "k1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	raw := rec.Body.String()
	for _, field := range []string{`"store":null`, `"price_cents":null`, `"old_price_cents":null`, `"posted_at":null`} {
		if !strings.Contains(raw, field) {
			t.Fatalf("response body missing %s: %s", field, raw)
		}
	}
}

func TestGetDealNotFound(t *testing.T) {
	handler := newDealServer(t, &stubDeals{byKey: map[string]domaindeal.Deal{}}, &spyPublisher{})

	req := httptest.NewRequest(http.MethodGet, "/deals/pld/missing", nil)
	req.Header.Set("X-API-Key", "k1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d; want 404", rec.Code)
	}
}

func TestDealRoutesRequireAPIKey(t *testing.T) {
	handler := newDealServer(t, &stubDeals{}, &spyPublisher{})

	for _, method := range []string{http.MethodPost, http.MethodGet} {
		req := httptest.NewRequest(method, "/deals", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without key: status = %d; want 401", method, rec.Code)
		}
	}
}

func TestInternalErrorOnPublishFailure(t *testing.T) {
	pub := &spyPublisher{err: errors.New("redis down")}
	handler := newDealServer(t, &stubDeals{}, pub)

	if rec := postDeals(handler, `{"source":"pld","source_deal_id":"1","title":"t","url":"https://e.com/1"}`); rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d; want 500", rec.Code)
	}
}
