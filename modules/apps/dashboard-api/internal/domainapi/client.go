// Package domainapi is dashboard-api's only persistence path: this
// service has no database of its own, it only stores the dashboard
// layout composition through the shared domain-api's dashboardlayout
// aggregate. There is no database driver here and there must never be
// one -- the whole point of this module split is that it talks HTTP
// like every other module service.
//
// Two shapes:
//
//   - Sync: POST /sync, which publishes the command and holds the
//     request open until domain-worker's audit row proves the write
//     landed. Used for both layout writes (save/delete) -- a layout
//     save/delete must be durable before the request returns, exactly
//     like cch-api's room create/delete.
//   - Get: GET /dashboardlayouts/{usuario}, a plain read.
package domainapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"
)

// ErrQueued is Sync's "gave up waiting" answer (the server's 504). The
// command was published and may still land -- it is not a rejection.
var ErrQueued = errors.New("domain: command still queued (worker did not confirm in time)")

// ErrRejected is Sync's 422: the worker looked at the command and
// refused it (validation, unknown action). Retrying unchanged will fail
// the same way -- this is permanent, unlike ErrQueued.
var ErrRejected = errors.New("domain: command rejected by worker")

// ErrNotFound is GetLayout's 404: no layout row exists for this
// usuario. The frontend's own embedded default layout takes over in
// this case -- it is not an error condition for the caller.
var ErrNotFound = errors.New("domain: dashboard layout not found")

// Client talks to domain-api with this service's own API key (each
// caller gets an identity so the audit log can name it).
type Client struct {
	base string
	key  string
	// syncHTTP allows for the server's own 10s wait plus round-trips;
	// readHTTP bounds the plain GET.
	syncHTTP *http.Client
	readHTTP *http.Client
}

// New builds a client. base is the origin (e.g. http://127.0.0.1:8000).
func New(base, key string) *Client {
	return &Client{
		base:     base,
		key:      key,
		syncHTTP: &http.Client{Timeout: 15 * time.Second},
		readHTTP: &http.Client{Timeout: 15 * time.Second},
	}
}

// NewFromEnv wires the client from DASHBOARD_DOMAIN_API_URL +
// DASHBOARD_DOMAIN_API_KEY.
func NewFromEnv() *Client {
	base := os.Getenv("DASHBOARD_DOMAIN_API_URL")
	key := os.Getenv("DASHBOARD_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// envelope is the write shape every domain-api route takes.
type envelope struct {
	Action  string `json:"action"`
	Payload any    `json:"payload,omitempty"`
}

// syncResponse is /sync's three possible outcomes on one struct.
type syncResponse struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
	EntityID  string `json:"entity_id"`
	Error     string `json:"error"`
}

// SaveLayoutPayload is the dashboardlayout.save action payload. Blocos
// rides as json.RawMessage -- this service validates its shape but does
// not need to understand it beyond that, so the array the caller sent
// is repassed byte-for-byte.
type SaveLayoutPayload struct {
	UsuarioEmail string          `json:"usuario_email"`
	Blocos       json.RawMessage `json:"blocos"`
}

// DeleteLayoutPayload is the dashboardlayout.delete action payload.
type DeleteLayoutPayload struct {
	UsuarioEmail string `json:"usuario_email"`
}

// SaveLayout persists (creates or replaces) the usuario's dashboard
// layout via /sync.
func (c *Client) SaveLayout(ctx context.Context, email string, blocos json.RawMessage) error {
	_, err := c.sync(ctx, "dashboardlayout.save", SaveLayoutPayload{UsuarioEmail: email, Blocos: blocos})
	return err
}

// DeleteLayout removes the usuario's dashboard layout personalization
// via /sync.
func (c *Client) DeleteLayout(ctx context.Context, email string) error {
	_, err := c.sync(ctx, "dashboardlayout.delete", DeleteLayoutPayload{UsuarioEmail: email})
	return err
}

// Layout mirrors the GET /dashboardlayouts/{usuario} response.
type Layout struct {
	UsuarioEmail string          `json:"usuario_email"`
	Blocos       json.RawMessage `json:"blocos"`
	AtualizadoEm time.Time       `json:"atualizado_em"`
}

// GetLayout reads the usuario's active dashboard layout. ErrNotFound
// mirrors domain-api's 404 -- no personalization saved.
func (c *Client) GetLayout(ctx context.Context, email string) (Layout, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/dashboardlayouts/"+url.PathEscape(email), nil)
	if err != nil {
		return Layout{}, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.readHTTP.Do(req)
	if err != nil {
		return Layout{}, fmt.Errorf("domain: GET /dashboardlayouts/%s: %w", email, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return Layout{}, ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return Layout{}, fmt.Errorf("domain: GET /dashboardlayouts/%s: status %d", email, resp.StatusCode)
	}
	var out Layout
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return Layout{}, fmt.Errorf("domain: decode GET /dashboardlayouts/%s: %w", email, err)
	}
	return out, nil
}

// sync publishes action and blocks until the worker's audit row lands.
// ErrQueued means "published, not yet confirmed"; ErrRejected means the
// worker refused the command; any other error means transport failure
// or an unexpected status.
func (c *Client) sync(ctx context.Context, action string, payload any) (string, error) {
	body, err := json.Marshal(envelope{Action: action, Payload: payload})
	if err != nil {
		return "", fmt.Errorf("domain: marshal %s payload: %w", action, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/sync", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.syncHTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("domain: POST /sync: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("domain: read /sync response: %w", err)
	}

	var out syncResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("domain: decode /sync response (status %d): %w", resp.StatusCode, err)
	}
	switch {
	case resp.StatusCode == http.StatusOK && out.Status == "written":
		return out.EntityID, nil
	case resp.StatusCode == http.StatusGatewayTimeout || out.Status == "queued":
		return "", fmt.Errorf("%w: %s", ErrQueued, out.Error)
	case resp.StatusCode == http.StatusUnprocessableEntity || out.Status == "failed":
		return "", fmt.Errorf("%w: %s", ErrRejected, out.Error)
	default:
		return "", fmt.Errorf("domain: %s was not written (status %d): %s", action, resp.StatusCode, out.Error)
	}
}
