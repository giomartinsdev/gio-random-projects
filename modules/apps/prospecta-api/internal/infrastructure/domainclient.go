// Package infrastructure holds the adapters that implement the application
// ports: the typed HTTP client for the domain pair (X-API-Key) and the AMQP
// publisher for the command envelope. This is the only layer that knows about
// the outside world. No database driver lives here -- prospecta-api never
// touches Postgres (§1.1).
package infrastructure

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// ErrNotConfigured is returned when the domain pair URL/key are absent (local
// dev without a domain pair). The transport turns it into a 503 rather than
// pretending a read succeeded.
var ErrNotConfigured = errors.New("domain pair not configured")

// DomainClient is the typed HTTP client for the domain pair. Reads hit the
// pair's GET projections; writes POST the bare {action, payload} envelope to
// /commands and answer with the command id. Every request carries X-API-Key.
type DomainClient struct {
	base string
	key  string

	// tenant is the MVP workspace id (multi-tenant RLS is enforced one level
	// down, in the pair's Postgres). It is injected into every read as
	// ?tenant_id= and into every command payload as tenant_id, because the
	// pair requires it on both doors. Empty means "no tenant header" (dev).
	tenant string

	readHTTP   *http.Client
	writeHTTP  *http.Client
	streamHTTP *http.Client
}

// New builds the client. tenant is optional (variadic so existing 2-arg call
// sites keep working); when present it is attached to every request.
func New(base, key string, tenant ...string) *DomainClient {
	t := ""
	if len(tenant) > 0 {
		t = tenant[0]
	}
	return &DomainClient{
		base:      strings.TrimRight(base, "/"),
		key:       key,
		tenant:    t,
		readHTTP:  &http.Client{Timeout: 15 * time.Second},
		writeHTTP: &http.Client{Timeout: 5 * time.Second},
		// No timeout on the streaming client: the pair keeps the SSE body open
		// for as long as the client is connected. Cancellation comes from the
		// request context, not a client deadline.
		streamHTTP: &http.Client{},
	}
}

// DefaultTenantID is the single MVP workspace. Override with
// PROSPECTA_TENANT_ID; it must be a UUID (the pair's tables are UUID NOT NULL).
const DefaultTenantID = "00000000-0000-0000-0000-000000000001"

// NewFromEnv wires from PROSPECTA_DOMAIN_API_URL + PROSPECTA_DOMAIN_API_KEY
// (+ optional PROSPECTA_TENANT_ID), the per-app prefix convention used across
// this repo. A nil *DomainClient is valid and means "not configured".
func NewFromEnv() *DomainClient {
	base, key := os.Getenv("PROSPECTA_DOMAIN_API_URL"), os.Getenv("PROSPECTA_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	tenant := os.Getenv("PROSPECTA_TENANT_ID")
	if tenant == "" {
		tenant = DefaultTenantID
	}
	return New(base, key, tenant)
}

func (c *DomainClient) Enabled() bool { return c != nil }

// getJSON issues an authenticated GET and decodes the projection into out. A
// 404 becomes domain.ErrNotFound so the transport can answer 404 (not 500).
func (c *DomainClient) getJSON(ctx context.Context, path string, out any) error {
	if c == nil {
		return ErrNotConfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+withTenant(path, c.tenant), nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", c.key)
	resp, err := c.readHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("domain pair GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return domain.ErrNotFound
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("domain pair GET %s: %d %s", path, resp.StatusCode, body)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("domain pair GET %s: decode: %w", path, err)
	}
	return nil
}

// Company decodes the GET /companies/{id} projection.
func (c *DomainClient) Company(ctx context.Context, id string) (domain.Company, error) {
	var company domain.Company
	if err := c.getJSON(ctx, "/companies/"+id, &company); err != nil {
		return domain.Company{}, err
	}
	return company, nil
}

// Campaign decodes the GET /campaigns/{id} projection.
func (c *DomainClient) Campaign(ctx context.Context, id string) (domain.Campaign, error) {
	var campaign domain.Campaign
	if err := c.getJSON(ctx, "/campaigns/"+id, &campaign); err != nil {
		return domain.Campaign{}, err
	}
	return campaign, nil
}

// ListCampaigns decodes the paginated GET /campaigns projection.
func (c *DomainClient) ListCampaigns(ctx context.Context, limit int, cursor string) (domain.Page[domain.Campaign], error) {
	var page domain.Page[domain.Campaign]
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	if err := c.getJSON(ctx, withQuery("/campaigns", q), &page); err != nil {
		return domain.Page[domain.Campaign]{}, err
	}
	return page, nil
}

// Lead decodes the GET /leads/{id} detail projection.
func (c *DomainClient) Lead(ctx context.Context, id string) (domain.Lead, error) {
	var lead domain.Lead
	if err := c.getJSON(ctx, "/leads/"+id, &lead); err != nil {
		return domain.Lead{}, err
	}
	return lead, nil
}

// ListLeads decodes the paginated, filtered GET /leads projection.
func (c *DomainClient) ListLeads(ctx context.Context, f application.LeadFilter) (domain.Page[domain.Lead], error) {
	var page domain.Page[domain.Lead]
	q := url.Values{}
	if f.CampaignID != "" {
		q.Set("campaign_id", f.CampaignID)
	}
	if f.Status != "" {
		q.Set("status", f.Status)
	}
	if f.FitMin > 0 {
		q.Set("fit_min", strconv.Itoa(f.FitMin))
	}
	if f.Limit > 0 {
		q.Set("limit", strconv.Itoa(f.Limit))
	}
	if f.Cursor != "" {
		q.Set("cursor", f.Cursor)
	}
	if err := c.getJSON(ctx, withQuery("/leads", q), &page); err != nil {
		return domain.Page[domain.Lead]{}, err
	}
	return page, nil
}

// Conversation decodes the GET /conversations/{id} thread projection.
func (c *DomainClient) Conversation(ctx context.Context, id string) (domain.Conversation, error) {
	var conv domain.Conversation
	if err := c.getJSON(ctx, "/conversations/"+id, &conv); err != nil {
		return domain.Conversation{}, err
	}
	return conv, nil
}

// ListConversations decodes the paginated GET /conversations projection.
func (c *DomainClient) ListConversations(ctx context.Context, limit int, cursor string) (domain.Page[domain.Conversation], error) {
	var page domain.Page[domain.Conversation]
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	if err := c.getJSON(ctx, withQuery("/conversations", q), &page); err != nil {
		return domain.Page[domain.Conversation]{}, err
	}
	return page, nil
}

// Message decodes the GET /messages/{id} projection, used to guard approve.
func (c *DomainClient) Message(ctx context.Context, id string) (domain.Message, error) {
	var message domain.Message
	if err := c.getJSON(ctx, "/messages/"+id, &message); err != nil {
		return domain.Message{}, err
	}
	return message, nil
}

// StreamActivity opens the pair's GET /agent/activity SSE stream and republishes
// decoded agent_run events on a channel. The producer exits -- and closes the
// channel -- as soon as ctx is cancelled (client disconnected) or the body
// ends, so no goroutine outlives the request.
func (c *DomainClient) StreamActivity(ctx context.Context) (<-chan domain.AgentRunEvent, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+withTenant("/agent/activity", c.tenant), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-API-Key", c.key)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.streamHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("domain pair GET /agent/activity: %w", err)
	}
	if resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, fmt.Errorf("domain pair GET /agent/activity: %d", resp.StatusCode)
	}

	events := make(chan domain.AgentRunEvent, 16)
	go func() {
		defer close(events)
		defer resp.Body.Close()
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		var data strings.Builder
		emit := func() {
			if data.Len() == 0 {
				return
			}
			var ev domain.AgentRunEvent
			if err := json.Unmarshal([]byte(data.String()), &ev); err == nil && ev.RunID != "" {
				select {
				case events <- ev:
				case <-ctx.Done():
				}
			}
			data.Reset()
		}
		for scanner.Scan() {
			line := scanner.Text()
			switch {
			case strings.HasPrefix(line, "data:"):
				data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			case line == "":
				emit()
			}
			if ctx.Err() != nil {
				return
			}
		}
		emit()
	}()
	return events, nil
}

func withQuery(path string, q url.Values) string {
	if len(q) == 0 {
		return path
	}
	return path + "?" + q.Encode()
}

// withTenant appends ?tenant_id=<tenant> unless the tenant is unset or the
// path already carries a query string (in which case it appends with &).
func withTenant(path, tenant string) string {
	if tenant == "" {
		return path
	}
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	return path + sep + "tenant_id=" + url.QueryEscape(tenant)
}

// acceptedBody is the /commands 202 shape.
type acceptedBody struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
}

// Publish posts the bare {action, payload} envelope to the domain pair's async
// door and returns the command id the pair stamped.
func (c *DomainClient) Publish(ctx context.Context, action string, payload any) (string, error) {
	if c == nil {
		return "", ErrNotConfigured
	}
	envelope := map[string]any{"action": action, "payload": payload}
	// The pair requires tenant_id on every command (UUID NOT NULL + RLS). It
	// is a server-side concern, not part of the public request body, so it is
	// folded into the payload here.
	if c.tenant != "" {
		if m, ok := payload.(map[string]any); ok {
			m["tenant_id"] = c.tenant
			envelope["payload"] = m
		}
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/commands", bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("X-API-Key", c.key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.writeHTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("domain pair POST /commands %s: %w", action, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		rawBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("domain pair POST /commands %s: %d %s", action, resp.StatusCode, rawBody)
	}
	var body acceptedBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("domain pair POST /commands %s: decode: %w", action, err)
	}
	if body.CommandID == "" {
		return "", fmt.Errorf("domain pair POST /commands %s: 202 without command_id", action)
	}
	return body.CommandID, nil
}
