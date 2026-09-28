package turn_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

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
		STUNURLs:     []string{"stun:stun.example.org:3478"},
		TurnURLs:     []string{"turn:turn.example.org:3478?transport=udp", "turn:turn.example.org:3478?transport=tcp"},
		TurnUsername: "user",
		TurnPassword: "pass",
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
		STUNURLs:     []string{"stun:stun.example.org:3478"},
		TurnURLs:     []string{"turn:turn.example.org:3478"},
		TurnUsername: "u",
		TurnPassword: "p",
		ForceRelay:   &off,
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

// Self-hosted coturn with `use-auth-secret`: the app mints a short-lived
// credential per request (the TURN REST API), so no fixed password sits
// in the browser and the relay can't be abused as an open relay. The
// username embeds the expiry; the credential is HMAC-SHA1(secret, user).
func TestCoturnSharedSecretMintsEphemeralCredentials(t *testing.T) {
	p := turn.New(turn.Options{
		STUNURLs:   []string{"stun:stun.example.org:3478"},
		TurnURLs:   []string{"turn:turn.example.org:3478?transport=udp", "turn:turn.example.org:3478?transport=tcp"},
		TurnSecret: "segredo-coturn",
		TurnTTL:    3600,
		TurnUserID: "tela",
	})
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if !forceRelay {
		t.Fatal("a configured coturn must force relay")
	}
	if len(servers) != 2 {
		t.Fatalf("servers = %+v, want STUN + coturn", servers)
	}
	entry := servers[1]
	if len(entry.URLs) != 2 {
		t.Fatalf("coturn urls = %v", entry.URLs)
	}
	// username is "<expiry>:<id>", expiry being a unix timestamp in the
	// future (roughly now+TTL).
	parts := strings.SplitN(entry.Username, ":", 2)
	if len(parts) != 2 {
		t.Fatalf("username %q is not <expiry>:<id>", entry.Username)
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		t.Fatalf("expiry not an int: %v", err)
	}
	now := time.Now().Unix()
	if exp < now+3000 || exp > now+3700 {
		t.Fatalf("expiry %d not ~now+3600 (%d)", exp, now)
	}
	// credential must be base64(HMAC-SHA1(secret, username)).
	mac := hmac.New(sha1.New, []byte("segredo-coturn"))
	mac.Write([]byte(entry.Username))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if entry.Credential != want {
		t.Fatalf("credential = %q, want %q", entry.Credential, want)
	}
}

// Two calls get fresh (distinct) credentials -- a leaked one expires
// and can't be reused indefinitely.
func TestCoturnCredentialsArePerRequest(t *testing.T) {
	p := turn.New(turn.Options{
		TurnURLs:   []string{"turn:turn.example.org:3478"},
		TurnSecret: "s",
		TurnTTL:    3600,
	})
	a, _, _ := p.IceServers(context.Background())
	time.Sleep(1100 * time.Millisecond)
	b, _, _ := p.IceServers(context.Background())
	if a[1].Username == b[1].Username {
		t.Fatal("expected the expiry to advance between calls")
	}
}

// A coturn with no secret falls back to a plain static entry (no auth
// mint) -- for an unprotected internal relay.
func TestCoturnWithoutSecretIsPlainStatic(t *testing.T) {
	p := turn.New(turn.Options{
		TurnURLs: []string{"turn:turn.example.org:3478"},
	})
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if !forceRelay || len(servers) != 2 {
		t.Fatalf("servers=%+v forceRelay=%v", servers, forceRelay)
	}
	if servers[1].Username != "" || servers[1].Credential != "" {
		t.Fatalf("no secret should mean no credentials, got %+v", servers[1])
	}
}

func TestNewFromEnvCoturn(t *testing.T) {
	t.Setenv("TELA_TURN_URLS", "turn:t:3478")
	t.Setenv("TELA_TURN_SECRET", "shh")
	t.Setenv("TELA_TURN_TTL", "600")
	p := turn.NewFromEnv()
	servers, forceRelay, err := p.IceServers(context.Background())
	if err != nil {
		t.Fatalf("ice: %v", err)
	}
	if !forceRelay || len(servers) != 2 {
		t.Fatalf("servers=%+v forceRelay=%v", servers, forceRelay)
	}
	if servers[1].Credential == "" {
		t.Fatal("expected a minted credential")
	}
}
