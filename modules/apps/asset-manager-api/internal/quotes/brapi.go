// Package quotes is the brapi.dev integration: an in-memory,
// non-durable cache of stock/FII quotes fronting
// GET https://brapi.dev/api/quote/{tickers}. This is the only state
// asset-manager-api keeps for itself -- everything else lives in
// domain-api.
//
// Fallback (FR-035, contracts/asset-manager-api.md): a caller that
// cannot get a quote here (network error, rate limit, unknown ticker)
// AND has no valid cache entry must fall back to the ativo's own
// ultima_cotacao/ultima_cotacao_em from domain-api and mark the
// response "desatualizada": true -- never a 5xx just because the
// external source is down. That fallback happens one layer up, in
// httpapi (which is the only place that has the ativo's persisted last
// known quote); this package's contract is simply: return an error
// when it has nothing fresh to offer, never panic, never block past its
// own timeout.
package quotes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// cotacaoTTL is how long a cached quote is served without hitting
// brapi.dev again.
const cotacaoTTL = 5 * time.Minute

// ErrNotFound means brapi.dev answered but had nothing for that ticker
// (delisted symbol, typo, etc.) -- distinct from a transport/HTTP
// error, though both trigger the same domain-api fallback upstream.
var ErrNotFound = errors.New("quotes: ticker not found")

// entry is one cached quote.
type entry struct {
	Preco    float64
	ObtidoEm time.Time
}

func (e entry) fresh(now time.Time) bool { return now.Sub(e.ObtidoEm) < cotacaoTTL }

// Quote is what callers get back: the price, when it was obtained, and
// whether it came from the cache (Fresh=false) or a live brapi.dev
// response (Fresh=true) -- httpapi only persists the "last known quote"
// back to domain-api when Fresh is true, to avoid re-writing the same
// value on every cache hit.
type Quote struct {
	Preco    float64
	ObtidoEm time.Time
	Fresh    bool
}

// Client is the brapi.dev quote source with its own in-memory cache.
type Client struct {
	baseURL string
	token   string
	http    *http.Client

	mu    sync.Mutex
	cache map[string]entry
}

// New builds a Client. baseURL is the brapi.dev API origin (e.g.
// https://brapi.dev/api); token is the bearer token -- always read from
// ASSET_MANAGER_BRAPI_TOKEN, never hardcoded.
func New(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 5 * time.Second},
		cache:   make(map[string]entry),
	}
}

// NewFromEnv wires the client from ASSET_MANAGER_BRAPI_BASE_URL
// (default https://brapi.dev/api) and ASSET_MANAGER_BRAPI_TOKEN.
func NewFromEnv() *Client {
	base := os.Getenv("ASSET_MANAGER_BRAPI_BASE_URL")
	if base == "" {
		base = "https://brapi.dev/api"
	}
	return New(base, os.Getenv("ASSET_MANAGER_BRAPI_TOKEN"))
}

// brapiResponse is the subset of brapi.dev's GET /quote/{tickers} shape
// this service needs.
type brapiResponse struct {
	Results []struct {
		Symbol             string  `json:"symbol"`
		RegularMarketPrice float64 `json:"regularMarketPrice"`
	} `json:"results"`
}

// Get returns one ticker's quote, cache-first. A cache hit within
// cotacaoTTL never touches the network. A cache miss/expiry calls
// brapi.dev for just that ticker; on success the cache is updated and
// Fresh=true is returned. On failure (network, non-2xx, ticker absent
// from results), the stale cache entry (if any, however old) is
// returned instead of an error -- so callers only see ErrNotFound/a
// transport error when there is truly nothing to fall back to here,
// which is the signal to use domain-api's persisted last-known quote.
func (c *Client) Get(ctx context.Context, ticker string) (Quote, error) {
	quotes, err := c.GetMany(ctx, []string{ticker})
	if err != nil {
		return Quote{}, err
	}
	q, ok := quotes[strings.ToUpper(ticker)]
	if !ok {
		return Quote{}, fmt.Errorf("%w: %s", ErrNotFound, ticker)
	}
	return q, nil
}

// GetMany resolves several tickers at once, cache-first, hitting
// brapi.dev in a single request only for the ones whose cache entry is
// missing or expired. A ticker that fails to resolve (network error
// mid-batch, or absent from brapi.dev's results) is simply omitted from
// the returned map rather than failing the whole batch -- callers check
// for their own ticker's presence.
func (c *Client) GetMany(ctx context.Context, tickers []string) (map[string]Quote, error) {
	out := make(map[string]Quote, len(tickers))
	now := time.Now()

	var toFetch []string
	c.mu.Lock()
	for _, t := range tickers {
		t = strings.ToUpper(strings.TrimSpace(t))
		if t == "" {
			continue
		}
		if e, ok := c.cache[t]; ok && e.fresh(now) {
			out[t] = Quote{Preco: e.Preco, ObtidoEm: e.ObtidoEm, Fresh: false}
			continue
		}
		toFetch = append(toFetch, t)
	}
	c.mu.Unlock()

	if len(toFetch) == 0 {
		return out, nil
	}

	fetched, err := c.fetch(ctx, toFetch)
	if err != nil {
		// brapi.dev failed for the tickers that needed a live lookup.
		// Serve whatever stale cache entry each of them still has
		// (however old -- better than nothing, and still Fresh=false so
		// callers know not to re-persist it) instead of dropping them.
		// A ticker with no cache entry at all stays out of the map, which
		// is the signal callers use to fall back further (domain-api's
		// own last-known quote).
		c.mu.Lock()
		for _, t := range toFetch {
			if e, ok := c.cache[t]; ok {
				out[t] = Quote{Preco: e.Preco, ObtidoEm: e.ObtidoEm, Fresh: false}
			}
		}
		c.mu.Unlock()
		if len(out) > 0 {
			return out, nil
		}
		return out, err
	}

	c.mu.Lock()
	for ticker, preco := range fetched {
		e := entry{Preco: preco, ObtidoEm: now}
		c.cache[ticker] = e
		out[ticker] = Quote{Preco: e.Preco, ObtidoEm: e.ObtidoEm, Fresh: true}
	}
	c.mu.Unlock()

	return out, nil
}

// fetch calls brapi.dev for exactly the given tickers (already
// uppercased) and returns symbol -> price.
func (c *Client) fetch(ctx context.Context, tickers []string) (map[string]float64, error) {
	url := c.baseURL + "/quote/" + strings.Join(tickers, ",")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("quotes: build request: %w", err)
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("quotes: GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("quotes: brapi.dev status %d", resp.StatusCode)
	}

	var parsed brapiResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("quotes: decode brapi.dev response: %w", err)
	}
	if len(parsed.Results) == 0 {
		return nil, fmt.Errorf("%w: %s", ErrNotFound, strings.Join(tickers, ","))
	}

	out := make(map[string]float64, len(parsed.Results))
	for _, r := range parsed.Results {
		out[strings.ToUpper(r.Symbol)] = r.RegularMarketPrice
	}
	return out, nil
}
