// Package cluster lets several tela-api nodes sit behind one hostname
// while each room lives on exactly one of them. A node that receives
// a request for a room it doesn't have asks its peers which one owns
// it (authenticated with a shared node token) and reverse-proxies the
// request -- WebSockets included -- to that node.
//
// v1 keeps it deliberately boring: static peer lists via
// TELA_NODE_PEERS, no membership protocol, no raft, no shared state.
// Rooms stay in each node's own registry; the cluster is only the
// routing fabric that makes "wrong node" invisible to clients.
package cluster

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"time"
)

// TokenHeader authenticates both directions of the internal traffic:
// a node asking "who owns this room" and a request being forwarded to
// its owning node. Without it, anyone who can reach the API could use
// the internal endpoints as an open proxy.
const TokenHeader = "X-Tela-Node-Token"

type Peer struct {
	Name string
	Base string // e.g. http://tela-api-2:8000
}

// ParsePeersEnv decodes TELA_NODE_PEERS: "name1=http://host1:8000,name2=http://host2:8000".
// Whitespace tolerated; empty string means no peers (single node).
func ParsePeersEnv(v string) ([]Peer, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil, nil
	}
	var peers []Peer
	for _, part := range strings.Split(v, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, base, found := strings.Cut(part, "=")
		if !found || strings.TrimSpace(name) == "" || strings.TrimSpace(base) == "" {
			return nil, fmt.Errorf("par inválido %q (formato: nome=http://host:porta)", part)
		}
		peers = append(peers, Peer{Name: strings.TrimSpace(name), Base: strings.TrimRight(strings.TrimSpace(base), "/")})
	}
	return peers, nil
}

type cacheEntry struct {
	target string
	at     time.Time
}

// cacheTTL bounds how long a room→node answer is trusted. Short on
// purpose: the cost of a stale entry is a proxied 404 (the origin
// answers truthfully), while the cost of a long TTL is a room that
// moved being unreachable for longer.
const cacheTTL = 15 * time.Second

type Cluster struct {
	self   string
	token  string
	peers  []Peer
	client *http.Client

	mu    sync.Mutex
	cache map[string]cacheEntry
	// One reverse proxy per peer base URL, built once -- NewSingleHost
	// allocates nothing per request, but there's no reason to rebuild
	// it either.
	proxies map[string]*httputil.ReverseProxy
}

func New(self, token string, peers []Peer) *Cluster {
	return &Cluster{
		self:    self,
		token:   token,
		peers:   peers,
		client:  &http.Client{Timeout: 3 * time.Second},
		cache:   make(map[string]cacheEntry),
		proxies: make(map[string]*httputil.ReverseProxy),
	}
}

func (c *Cluster) Self() string { return c.self }
func (c *Cluster) Token() string { return c.token }

func (c *Cluster) Enabled() bool { return len(c.peers) > 0 }

// Locate asks each peer, in order, whether it owns roomID; the first
// yes wins. Answers are cached for cacheTTL. False means no peer
// admitted owning the room -- the caller answers 404 locally.
func (c *Cluster) Locate(ctx context.Context, roomID string) (string, bool) {
	c.mu.Lock()
	if e, ok := c.cache[roomID]; ok && time.Since(e.at) < cacheTTL {
		c.mu.Unlock()
		return e.target, true
	}
	c.mu.Unlock()

	for _, p := range c.peers {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet,
			p.Base+"/internal/rooms/"+url.PathEscape(roomID)+"/owner", nil)
		if err != nil {
			continue
		}
		req.Header.Set(TokenHeader, c.token)
		resp, err := c.client.Do(req)
		if err != nil {
			continue // peer down: try the next one
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			c.mu.Lock()
			c.cache[roomID] = cacheEntry{target: p.Base, at: time.Now()}
			c.mu.Unlock()
			return p.Base, true
		}
	}
	return "", false
}

// Proxy forwards the request to a peer, tagged so the peer's own CORS
// layer leaves it alone (the client-facing CORS was already handled
// by whoever the browser talked to first -- a second layer here would
// duplicate the header and break the browser).
func (c *Cluster) Proxy(w http.ResponseWriter, r *http.Request, target string) {
	c.mu.Lock()
	proxy, ok := c.proxies[target]
	if !ok {
		if u, err := url.Parse(target); err == nil {
			proxy = httputil.NewSingleHostReverseProxy(u)
			c.proxies[target] = proxy
		}
	}
	c.mu.Unlock()
	if proxy == nil {
		http.Error(w, "nó desconhecido", http.StatusBadGateway)
		return
	}
	r.Header.Set(TokenHeader, c.token)
	proxy.ServeHTTP(w, r)
}

// RemoteRooms asks every live peer for its own "salas rolando" list,
// so the home page sees the whole cluster instead of only the node it
// happened to hit. Failures are skipped -- one node down must not
// blank the list.
func (c *Cluster) RemoteRooms(ctx context.Context) []RoomSummary {
	type remoteList struct {
		Rooms []RoomSummary `json:"rooms"`
	}
	var out []RoomSummary
	for _, p := range c.peers {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.Base+"/internal/rooms", nil)
		if err != nil {
			continue
		}
		req.Header.Set(TokenHeader, c.token)
		resp, err := c.client.Do(req)
		if err != nil {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if err != nil || resp.StatusCode != http.StatusOK {
			continue
		}
		var list remoteList
		if err := parseJSON(body, &list); err != nil {
			continue
		}
		out = append(out, list.Rooms...)
	}
	return out
}