// Package domainapi is leads-api's persistence client -- this service
// has no database of its own, same shape as every other -api in the
// financas feature. It only ever does one thing: publish a
// "lead.create" command via domain-api's generic POST /sync, so the
// caller (the landing page) gets an immediate, confirmed answer
// instead of pretending an e-mail was captured when it wasn't.
package domainapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

var (
	// ErrQueued is /sync's "gave up waiting" answer (its own 504). The
	// command was published and may still land.
	ErrQueued = errors.New("domain: command still queued (worker did not confirm in time)")
	// ErrRejected is /sync's 422: the worker looked at the command and
	// refused it (an invalid e-mail, most likely).
	ErrRejected = errors.New("domain: command rejected by worker")
)

type Client struct {
	base string
	key  string
	http *http.Client
}

func New(base, key string) *Client {
	return &Client{base: base, key: key, http: &http.Client{Timeout: 15 * time.Second}}
}

// NewFromEnv wires the client from LEADS_DOMAIN_API_URL/
// LEADS_DOMAIN_API_KEY. Either unset returns nil -- callers must treat
// that as "persistence unavailable" and fail loudly (a lead silently
// dropped defeats the entire point of this service).
func NewFromEnv() *Client {
	base, key := os.Getenv("LEADS_DOMAIN_API_URL"), os.Getenv("LEADS_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

func (c *Client) Enabled() bool { return c != nil }

type envelope struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
}

type syncResponse struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
	EntityID  string `json:"entity_id"`
	Error     string `json:"error"`
}

// CaptureEmail publishes lead.create and blocks until the worker's
// audit row confirms it, or until /sync gives up (10s server-side).
func (c *Client) CaptureEmail(ctx context.Context, email string) error {
	if c == nil {
		return fmt.Errorf("domain: cliente não configurado")
	}
	raw, err := json.Marshal(map[string]string{"email": email})
	if err != nil {
		return fmt.Errorf("domain: marshal payload: %w", err)
	}
	body, err := json.Marshal(envelope{Action: "lead.create", Payload: raw})
	if err != nil {
		return fmt.Errorf("domain: marshal envelope: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/sync", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("domain: POST /sync: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("domain: read /sync response: %w", err)
	}
	var out syncResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return fmt.Errorf("domain: decode /sync response (status %d): %w", resp.StatusCode, err)
	}
	switch {
	case resp.StatusCode == http.StatusOK && out.Status == "written":
		return nil
	case resp.StatusCode == http.StatusGatewayTimeout || out.Status == "queued":
		return fmt.Errorf("%w: %s", ErrQueued, out.Error)
	case resp.StatusCode == http.StatusUnprocessableEntity || out.Status == "failed":
		return fmt.Errorf("%w: %s", ErrRejected, out.Error)
	default:
		return fmt.Errorf("domain: lead.create was not written (status %d): %s", resp.StatusCode, out.Error)
	}
}
