// Package domainclient is clubs-api's persistence client. Everything this
// service durably remembers goes through the platform's domain-api — there
// is no database driver here and there must never be one, same as cch-api
// and the financas modules.
//
// Reads go straight to domain-api's GET routes. Writes come in two shapes,
// deliberately separate:
//
//   - Sync: POST /sync, which publishes the command and holds the request
//     open until domain-worker's audit row proves the write landed. Used for
//     the structural writes where "the follow exists" must survive a reload
//     seconds later (watchlist, claimed pro, notification prefs).
//   - Async: the normal 202 path, used by the ingest worker for the
//     append-only high-volume writes (snapshot, announcement) — nobody waits
//     for those.
//
// A nil Client is valid and means "no persistence" (local dev without
// domain-api): every method short-circuits.
package domainclient

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

// ErrQueued is Sync's "gave up waiting" answer — the command was published
// and may still land. Not a rejection.
var ErrQueued = errors.New("domain: command still queued")

// ErrRejected is Sync's 422: the worker refused the command. Retrying
// unchanged fails the same way.
var ErrRejected = errors.New("domain: command rejected by worker")

type Client struct {
	base string
	key  string

	syncHTTP  *http.Client
	asyncHTTP *http.Client
	readHTTP  *http.Client
}

func New(base, key string) *Client {
	return &Client{
		base:      base,
		key:       key,
		syncHTTP:  &http.Client{Timeout: 15 * time.Second},
		asyncHTTP: &http.Client{Timeout: 5 * time.Second},
		readHTTP:  &http.Client{Timeout: 15 * time.Second},
	}
}

// NewFromEnv wires from CLUBS_DOMAIN_API_URL + CLUBS_DOMAIN_API_KEY (the
// per-app prefix convention; the ingest worker has its own key).
func NewFromEnv() *Client {
	base, key := os.Getenv("CLUBS_DOMAIN_API_URL"), os.Getenv("CLUBS_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

func (c *Client) Enabled() bool { return c != nil }

// Get performs a read and decodes into out.
func (c *Client) Get(ctx context.Context, path string, out any) error {
	if c == nil {
		return errors.New("domain-api not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.key)
	resp, err := c.readHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("domain-api GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("domain-api GET %s: %d %s", path, resp.StatusCode, body)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// ErrNotFound is domain-api's 404 over a read.
var ErrNotFound = errors.New("not found")

// Sync publishes a command and waits for the worker's audit row to prove it
// landed (domain-api's POST /sync).
func (c *Client) Sync(ctx context.Context, action string, payload any) error {
	raw, err := json.Marshal(map[string]any{"action": action, "payload": payload})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/sync", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.syncHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("domain-api sync %s: %w", action, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusUnprocessableEntity:
		return ErrRejected
	case resp.StatusCode == http.StatusGatewayTimeout:
		return ErrQueued
	case resp.StatusCode >= 300:
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("domain-api sync %s: %d %s", action, resp.StatusCode, body)
	}
	return nil
}

// Post fires a command on the async 202 path (nobody waits for the answer).
func (c *Client) Post(ctx context.Context, path string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.asyncHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("domain-api POST %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("domain-api POST %s: %d %s", path, resp.StatusCode, body)
	}
	return nil
}

// Escape is shorthand for query-string building.
func Escape(v string) string { return url.QueryEscape(v) }
