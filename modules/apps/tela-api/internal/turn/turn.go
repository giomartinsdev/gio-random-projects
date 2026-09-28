// Package turn decides which ICE servers the browser gets.
//
// STUN tells a browser its own public address; TURN relays the media
// when the direct path between the browser and MediaMTX can't carry it
// (a hostile network, or a path that drops the large DTLS handshake
// packets). Because MediaMTX has a public IP, a TURN relay reaches it
// directly -- so only the browser side ever needs the relay, which is
// what makes a managed TURN (Cloudflare's) enough here.
//
// Three configurations, in priority order:
//  1. Cloudflare TURN: credentials minted server-side and cached; the
//     account token never leaves this process.
//  2. A static TURN (self-hosted coturn): URLs + a fixed credential.
//  3. STUN only: the default, and the fallback whenever a mint fails.
package turn

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// DefaultSTUN is used when nothing is configured. Cloudflare's edge (and
// MediaMTX) reach it fine, and it costs nothing.
var DefaultSTUN = []string{"stun:stun.l.google.com:19302"}

// IceServer is the shape the browser's RTCPeerConnection expects. URLs is
// a list so one TURN entry can carry several transports (udp, tcp, tls).
type IceServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// Options is the resolved configuration. Zero-value URLs means "not
// configured".
type Options struct {
	STUNURLs []string
	// A static TURN: coturn, say. When set, credentials are passed
	// through verbatim.
	StaticURLs []string
	Username   string
	Credential string
	// Cloudflare TURN. CFAPIBase is overridable for tests.
	CFAPIBase     string
	CFKeyID       string
	CFAPIToken    string
	CFTTLSeconds  int
	CFCachePeriod int
	// ForceRelay pins the browser to the relay instead of letting it try
	// the direct path first. Defaults to true whenever a TURN exists:
	// the only reason to configure one is that the direct path failed.
	ForceRelay *bool
}

// boolPtr is a tiny helper for the tests and env parsing.
func BoolPtr(v bool) *bool { return &v }

// New builds a Proxy from explicit options.
func New(opts Options) *Proxy {
	if opts.CFAPIBase == "" {
		opts.CFAPIBase = "https://rtc.live.cloudflare.com/v1"
	}
	if len(opts.STUNURLs) == 0 {
		opts.STUNURLs = DefaultSTUN
	}
	if opts.CFTTLSeconds <= 0 {
		opts.CFTTLSeconds = 86400
	}
	if opts.CFCachePeriod <= 0 {
		// Refresh well before the 24h TTL.
		opts.CFCachePeriod = 6 * 60 * 60
	}
	return &Proxy{opts: opts, client: &http.Client{Timeout: 4 * time.Second}}
}

// NewFromEnv reads the deployment's ICE configuration from the
// environment. All optional; unset means STUN-only.
func NewFromEnv() *Proxy {
	return New(Options{
		STUNURLs:     splitList(os.Getenv("TELA_STUN_URLS")),
		StaticURLs:   splitList(os.Getenv("TELA_TURN_URLS")),
		Username:     os.Getenv("TELA_TURN_USERNAME"),
		Credential:   os.Getenv("TELA_TURN_PASSWORD"),
		CFKeyID:      os.Getenv("TELA_TURN_CF_KEY_ID"),
		CFAPIToken:   os.Getenv("TELA_TURN_CF_API_TOKEN"),
		CFTTLSeconds: envInt("TELA_TURN_CF_TTL", 86400),
	})
}

// Proxy mints and caches ICE servers.
type Proxy struct {
	opts   Options
	client *http.Client

	mu       sync.Mutex
	cached   []IceServer
	cacheKey string
	cacheExp time.Time
}

// HasRelay reports whether any TURN is configured (Cloudflare or static).
func (p *Proxy) HasRelay() bool {
	return p != nil && (len(p.opts.StaticURLs) > 0 || (p.opts.CFKeyID != "" && p.opts.CFAPIToken != ""))
}

// IceServers returns the STUN entries followed by at most one TURN entry,
// plus whether the browser should be forced onto the relay. A Cloudflare
// mint failure degrades to STUN-only rather than erroring: a broken token
// must not take screen sharing down with it.
func (p *Proxy) IceServers(ctx context.Context) ([]IceServer, bool, error) {
	if p == nil {
		return []IceServer{{URLs: DefaultSTUN}}, false, nil
	}
	servers := make([]IceServer, 0, len(p.opts.STUNURLs)+1)
	for _, u := range p.opts.STUNURLs {
		servers = append(servers, IceServer{URLs: []string{u}})
	}

	relay, ok := p.staticRelay()
	if !ok && p.cfConfigured() {
		minted, err := p.cloudflare(ctx)
		if err != nil {
			// Log-free package: the caller's HTTP handler logs it. Just
			// fall back to STUN.
			return servers, false, nil
		}
		relay, ok = minted, true
	}
	if ok {
		servers = append(servers, relay)
	}
	return servers, p.forceRelay(ok), nil
}

func (p *Proxy) staticRelay() (IceServer, bool) {
	if len(p.opts.StaticURLs) == 0 {
		return IceServer{}, false
	}
	return IceServer{URLs: p.opts.StaticURLs, Username: p.opts.Username, Credential: p.opts.Credential}, true
}

func (p *Proxy) cfConfigured() bool {
	return p.opts.CFKeyID != "" && p.opts.CFAPIToken != ""
}

// forceRelay resolves the ForceRelay option. Default true when a relay is
// present -- a configured relay exists to be used.
func (p *Proxy) forceRelay(hasRelay bool) bool {
	if p.opts.ForceRelay != nil {
		return *p.opts.ForceRelay
	}
	return hasRelay
}

// cloudflare mints (or returns a cached) Cloudflare TURN credential set.
// Cached until CFCachePeriod, which is well inside the credential's TTL.
func (p *Proxy) cloudflare(ctx context.Context) (IceServer, error) {
	p.mu.Lock()
	if p.cached != nil && p.cacheKey == p.opts.CFKeyID && time.Now().Before(p.cacheExp) {
		cached := p.cached[0]
		p.mu.Unlock()
		return cached, nil
	}
	p.mu.Unlock()

	url := fmt.Sprintf("%s/turn/keys/%s/credentials/generate-ice-servers", strings.TrimRight(p.opts.CFAPIBase, "/"), p.opts.CFKeyID)
	body := fmt.Sprintf(`{"ttl":%d}`, p.opts.CFTTLSeconds)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return IceServer{}, err
	}
	req.Header.Set("Authorization", "Bearer "+p.opts.CFAPIToken)
	req.Header.Set("Content-Type", "application/json")

	res, err := p.client.Do(req)
	if err != nil {
		return IceServer{}, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		return IceServer{}, fmt.Errorf("cloudflare turn: HTTP %d", res.StatusCode)
	}

	var parsed struct {
		IceServers json.RawMessage `json:"iceServers"`
	}
	if err := json.NewDecoder(res.Body).Decode(&parsed); err != nil {
		return IceServer{}, err
	}
	entry, err := normalizeIceServers(parsed.IceServers)
	if err != nil {
		return IceServer{}, err
	}

	p.mu.Lock()
	p.cached = []IceServer{entry}
	p.cacheKey = p.opts.CFKeyID
	p.cacheExp = time.Now().Add(time.Duration(p.opts.CFCachePeriod) * time.Second)
	p.mu.Unlock()
	return entry, nil
}

// normalizeIceServers handles both shapes Cloudflare's API can return: a
// single object, or an array of them. They're flattened into one entry
// (the browser accepts several URLs on one server).
func normalizeIceServers(raw json.RawMessage) (IceServer, error) {
	if len(raw) == 0 {
		return IceServer{}, fmt.Errorf("cloudflare turn: no iceServers in response")
	}
	// Try array first, then object.
	var list []struct {
		URLs       json.RawMessage `json:"urls"`
		Username   string          `json:"username"`
		Credential string          `json:"credential"`
	}
	if err := json.Unmarshal(raw, &list); err == nil && len(list) > 0 {
		out := IceServer{}
		for _, e := range list {
			out.URLs = append(out.URLs, parseURLs(e.URLs)...)
			if out.Username == "" {
				out.Username = e.Username
			}
			if out.Credential == "" {
				out.Credential = e.Credential
			}
		}
		if len(out.URLs) == 0 {
			return IceServer{}, fmt.Errorf("cloudflare turn: empty urls")
		}
		return out, nil
	}
	var single struct {
		URLs       json.RawMessage `json:"urls"`
		Username   string          `json:"username"`
		Credential string          `json:"credential"`
	}
	if err := json.Unmarshal(raw, &single); err != nil {
		return IceServer{}, fmt.Errorf("cloudflare turn: bad iceServers: %w", err)
	}
	urls := parseURLs(single.URLs)
	if len(urls) == 0 {
		return IceServer{}, fmt.Errorf("cloudflare turn: empty urls")
	}
	return IceServer{URLs: urls, Username: single.Username, Credential: single.Credential}, nil
}

// parseURLs accepts either a string or an array of strings, the two
// shapes the RTC spec allows for `urls`.
func parseURLs(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var one string
	if err := json.Unmarshal(raw, &one); err == nil {
		if one == "" {
			return nil
		}
		return []string{one}
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err == nil {
		return many
	}
	return nil
}

func splitList(v string) []string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	fields := strings.FieldsFunc(v, func(r rune) bool { return r == ',' || r == ' ' })
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f = strings.TrimSpace(f); f != "" {
			out = append(out, f)
		}
	}
	return out
}

func envInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n <= 0 {
		return fallback
	}
	return n
}
