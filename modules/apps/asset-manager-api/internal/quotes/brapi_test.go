package quotes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// fakeBrapi stands in for brapi.dev: it counts requests and can be
// switched to fail on demand, so tests control both the cache-hit and
// the fallback paths without touching the real network.
func fakeBrapi(t *testing.T, price float64, fail *atomic.Bool, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if fail.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{"symbol": "PETR4", "regularMarketPrice": price},
			},
		})
	}))
}

func TestGet_CacheHitWithinTTLDoesNotCallExternalAPI(t *testing.T) {
	var fail atomic.Bool
	var calls atomic.Int32
	srv := fakeBrapi(t, 30.5, &fail, &calls)
	defer srv.Close()

	c := New(srv.URL, "unused-token")

	q1, err := c.Get(context.Background(), "PETR4")
	if err != nil {
		t.Fatalf("first Get: %v", err)
	}
	if q1.Preco != 30.5 || !q1.Fresh {
		t.Fatalf("first Get: got %+v, want fresh 30.5", q1)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected 1 call to brapi.dev after first Get, got %d", got)
	}

	// Second call within TTL must be served from cache: no new request,
	// and Fresh reports false so the caller knows not to re-persist it.
	q2, err := c.Get(context.Background(), "petr4")
	if err != nil {
		t.Fatalf("second Get (cache hit): %v", err)
	}
	if q2.Preco != 30.5 || q2.Fresh {
		t.Fatalf("second Get: got %+v, want cached (non-fresh) 30.5", q2)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("cache hit should not call brapi.dev again, got %d calls", got)
	}
}

func TestGet_FallsBackOnExternalErrorWithoutCache(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	var calls atomic.Int32
	srv := fakeBrapi(t, 0, &fail, &calls)
	defer srv.Close()

	c := New(srv.URL, "unused-token")

	_, err := c.Get(context.Background(), "PETR4")
	if err == nil {
		t.Fatal("expected an error when brapi.dev fails and there is no cache, got nil")
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected exactly 1 attempted call, got %d", got)
	}
}

func TestGet_FallsBackToStaleCacheWhenExternalAPIFailsLater(t *testing.T) {
	var fail atomic.Bool
	var calls atomic.Int32
	srv := fakeBrapi(t, 42.0, &fail, &calls)
	defer srv.Close()

	c := New(srv.URL, "unused-token")
	// Prime the cache directly, already expired, so the next Get is
	// forced to hit the (now failing) external API and must fall back
	// to the stale entry rather than erroring out.
	c.mu.Lock()
	c.cache["PETR4"] = entry{Preco: 41.0}
	c.mu.Unlock()

	fail.Store(true)
	q, err := c.Get(context.Background(), "PETR4")
	if err != nil {
		t.Fatalf("expected fallback to stale cache, got error: %v", err)
	}
	if q.Preco != 41.0 || q.Fresh {
		t.Fatalf("expected stale cached price 41.0 (Fresh=false), got %+v", q)
	}
}

func TestGetMany_PartialCacheHitOnlyFetchesMissingTickers(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{"symbol": "MXRF11", "regularMarketPrice": 10.1},
			},
		})
	}))
	defer srv.Close()

	c := New(srv.URL, "unused-token")
	// PETR4 is already fresh in cache; only MXRF11 should be fetched.
	c.mu.Lock()
	c.cache["PETR4"] = entry{Preco: 30.0, ObtidoEm: time.Now()}
	c.mu.Unlock()

	out, err := c.GetMany(context.Background(), []string{"PETR4", "MXRF11"})
	if err != nil {
		t.Fatalf("GetMany: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected 2 quotes, got %d: %+v", len(out), out)
	}
	if out["PETR4"].Fresh {
		t.Fatalf("PETR4 should have come from cache (Fresh=false), got %+v", out["PETR4"])
	}
	if !out["MXRF11"].Fresh {
		t.Fatalf("MXRF11 should have been freshly fetched, got %+v", out["MXRF11"])
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("expected exactly 1 external call (for the missing ticker only), got %d", got)
	}
}
