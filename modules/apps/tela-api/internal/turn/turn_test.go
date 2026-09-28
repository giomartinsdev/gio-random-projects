package turn_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/turn"
)

// Unconfigured: STUN only, no relay. Rooms still work; screen sharing
// just won't get a relay fallback on a hostile network.
func TestUnconfiguredOffersOnlyStun(t *testing.T) {
	p := turn.New(turn.Options{STUNURLs: []string{"stun:stun.example.org:3478"}})
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if len(servers) != 1 || len(servers[0].URLs) != 1 || servers[0].URLs[0] != "stun:stun.example.org:3478" {
		t.Fatalf("servers = %+v, want just the STUN entry", servers)
	}
	if forceRelay {
		t.Fatal("relay must not be forced without TURN")
	}
}

// A static TURN (self-hosted coturn, say) is offered verbatim, with its
// credentials, and relay is forced -- the only reason to configure a
// relay is that the direct path is not usable.
func TestStaticTurnIsOfferedWithCredentials(t *testing.T) {
	p := turn.New(turn.Options{
		STUNURLs:   []string{"stun:stun.example.org:3478"},
		StaticURLs: []string{"turn:turn.example.org:3478?transport=udp", "turn:turn.example.org:3478?transport=tcp"},
		Username:   "user",
		Credential: "pass",
	})
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if !forceRelay {
		t.Fatal("a configured TURN must force relay")
	}
	if len(servers) != 2 {
		t.Fatalf("servers = %+v, want STUN + one TURN entry", servers)
	}
	if servers[0].URLs[0] != "stun:stun.example.org:3478" {
		t.Fatalf("STUN must come first, got %+v", servers[0])
	}
	got := servers[1]
	if got.Username != "user" || got.Credential != "pass" {
		t.Fatalf("turn creds = %q/%q", got.Username, got.Credential)
	}
	if len(got.URLs) != 2 {
		t.Fatalf("turn urls = %v, want both transports on one entry", got.URLs)
	}
}

// Cloudflare TURN: credentials are minted server-side, cached, and
// relay is forced. The account token never reaches the browser.
func TestCloudflareTurnMintsAndCaches(t *testing.T) {
	var calls int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if !strings.Contains(r.URL.Path, "/keys/keyid/credentials/generate-ice-servers") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var body struct {
			TTL int `json:"ttl"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body.TTL <= 0 {
			t.Errorf("expected a positive ttl, got %d", body.TTL)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"iceServers": map[string]any{
				"urls":       []string{"turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349"},
				"username":   "cf-user",
				"credential": "cf-pass",
			},
		})
	}))
	defer api.Close()

	p := turn.New(turn.Options{
		STUNURLs:      []string{"stun:stun.example.org:3478"},
		CFAPIBase:     api.URL,
		CFKeyID:       "keyid",
		CFAPIToken:    "tok",
		CFTTLSeconds:  3600,
		CFCachePeriod: 60,
	})
	for i := 0; i < 3; i++ {
		servers, forceRelay, err := p.IceServers(context.Background())
		if err != nil {
			t.Fatalf("ice %d: %v", i, err)
		}
		if !forceRelay {
			t.Fatal("cloudflare turn must force relay")
		}
		if len(servers) != 2 {
			t.Fatalf("servers = %+v", servers)
		}
		turnEntry := servers[1]
		if turnEntry.Username != "cf-user" || turnEntry.Credential != "cf-pass" {
			t.Fatalf("minted creds = %q/%q", turnEntry.Username, turnEntry.Credential)
		}
		if len(turnEntry.URLs) != 2 {
			t.Fatalf("minted urls = %v", turnEntry.URLs)
		}
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("mint called %d times, want 1 (cached)", got)
	}
}

// A mint failure falls back to STUN-only rather than killing the request
// -- a broken Cloudflare token must not take screen sharing down with
// it, it just loses the relay.
func TestCloudflareFailureFallsBackToStun(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer api.Close()

	p := turn.New(turn.Options{
		STUNURLs:   []string{"stun:stun.example.org:3478"},
		CFAPIBase:  api.URL,
		CFKeyID:    "keyid",
		CFAPIToken: "tok",
	})
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("a mint failure must not error out: %v", err)
	}
	if len(servers) != 1 || forceRelay {
		t.Fatalf("servers=%+v forceRelay=%v, want STUN-only non-relay", servers, forceRelay)
	}
}

func TestForceRelayCanBeTurnedOffExplicitly(t *testing.T) {
	off := false
	p := turn.New(turn.Options{
		STUNURLs:   []string{"stun:stun.example.org:3478"},
		StaticURLs: []string{"turn:turn.example.org:3478"},
		Username:   "u",
		Credential: "p",
		ForceRelay: &off,
	})
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if forceRelay {
		t.Fatal("ForceRelay=false must not force relay")
	}
	if len(servers) != 2 {
		t.Fatalf("servers = %+v, want STUN + TURN", servers)
	}
}

func TestNewFromEnv(t *testing.T) {
	t.Setenv("TELA_STUN_URLS", "stun:a:3478 stun:b:3478")
	t.Setenv("TELA_TURN_URLS", "turn:t:3478?transport=udp")
	t.Setenv("TELA_TURN_USERNAME", "u")
	t.Setenv("TELA_TURN_PASSWORD", "p")

	p := turn.NewFromEnv()
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if !forceRelay {
		t.Fatal("turn urls in env must force relay")
	}
	if len(servers) != 3 {
		t.Fatalf("servers = %+v, want two STUN + one TURN", servers)
	}
	if servers[0].URLs[0] != "stun:a:3478" || servers[1].URLs[0] != "stun:b:3478" {
		t.Fatalf("stun entries = %+v / %+v", servers[0], servers[1])
	}
}

func TestDefaultSTUNWhenUnset(t *testing.T) {
	t.Setenv("TELA_STUN_URLS", "")
	p := turn.NewFromEnv()
	servers, _, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if len(servers) == 0 {
		t.Fatal("expected a default STUN server when none is configured")
	}
}
