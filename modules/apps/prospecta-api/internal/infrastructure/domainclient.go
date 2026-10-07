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
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/identity"
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

	// fallbackTenant is the operator workspace id (the multi-tenant RLS is
	// enforced one level down, in the pair's Postgres). It is used only when
	// the request carries no resolved identity -- i.e. the X-API-Key operator
	// path. A logged-in session overrides it with the session's tenant_id, so
	// every read and command is scoped to the caller's own tenant. Empty means
	// "no tenant header" (dev without a configured operator tenant).
	fallbackTenant string

	readHTTP   *http.Client
	writeHTTP  *http.Client
	streamHTTP *http.Client
}

// tenantFor resolves the tenant for a call: the identity injected by the
// middleware when present, otherwise the operator fallback from the env. The
// identity package is a leaf, so importing it here creates no cycle.
func (c *DomainClient) tenantFor(ctx context.Context) string {
	if t := identity.TenantID(ctx); t != "" {
		return t
	}
	return c.fallbackTenant
}

// publishTenant resolves the tenant_id to stamp into a command payload.
//   - session (non-operator identity): the session tenant, always.
//   - operator (X-API-Key, a system principal): the payload's own tenant_id
//     when it carries one (the agent worker knows the event's tenant), else the
//     operator fallback.
func (c *DomainClient) publishTenant(ctx context.Context, payload map[string]any) string {
	if id, ok := identity.From(ctx); ok && !id.Operator && id.TenantID != "" {
		return id.TenantID
	}
	if t, _ := payload["tenant_id"].(string); t != "" {
		return t
	}
	return c.tenantFor(ctx)
}
// New builds the client. tenant is optional (variadic so existing 2-arg call
// sites keep working); when present it is the operator fallback tenant.
func New(base, key string, tenant ...string) *DomainClient {
	t := ""
	if len(tenant) > 0 {
		t = tenant[0]
	}
	return &DomainClient{
		base:           strings.TrimRight(base, "/"),
		key:            key,
		fallbackTenant: t,
		readHTTP:       &http.Client{Timeout: 15 * time.Second},
		writeHTTP:      &http.Client{Timeout: 5 * time.Second},
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
	return c.getJSONURL(ctx, c.base+withTenant(path, c.tenantFor(ctx)), path, out)
}

// getJSONNoTenant is getJSON without the ?tenant_id= scope. It exists for the
// few reads that are cross-tenant by design (the by-phone lead lookup): the
// pair resolves them globally and a tenant would be meaningless.
func (c *DomainClient) getJSONNoTenant(ctx context.Context, path string, out any) error {
	return c.getJSONURL(ctx, c.base+path, path, out)
}

func (c *DomainClient) getJSONURL(ctx context.Context, fullURL, path string, out any) error {
	if c == nil {
		return ErrNotConfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
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

// UserByEmail decodes the GET /users/by-email/{email} projection. A missing
// user surfaces as domain.ErrNotFound, which the auth slice treats as "unknown
// account" (401 on login, no conflict on signup).
func (c *DomainClient) UserByEmail(ctx context.Context, email string) (domain.User, error) {
	var user domain.User
	if err := c.getJSON(ctx, "/users/by-email/"+url.PathEscape(email), &user); err != nil {
		return domain.User{}, err
	}
	return user, nil
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

// OptOut decodes GET /opt-outs/{lead_id}: the LGPD guardrail. The pair always
// answers 200, so a missing opt-out is a false value, not a 404.
func (c *DomainClient) OptOut(ctx context.Context, leadID string) (domain.OptOut, error) {
	var out domain.OptOut
	if err := c.getJSON(ctx, "/opt-outs/"+url.PathEscape(leadID), &out); err != nil {
		return domain.OptOut{}, err
	}
	return out, nil
}

// LeadByPhone decodes GET /leads/by-phone/{number}. The lookup is cross-tenant
// on purpose, so no tenant is sent; a number that matches nothing is 404.
func (c *DomainClient) LeadByPhone(ctx context.Context, number string) (domain.LeadPhone, error) {
	var lead domain.LeadPhone
	if err := c.getJSONNoTenant(ctx, "/leads/by-phone/"+url.PathEscape(number), &lead); err != nil {
		return domain.LeadPhone{}, err
	}
	return lead, nil
}

// StreamActivity opens the pair's GET /agent/activity SSE stream and republishes
// decoded agent_run events on a channel. The producer exits -- and closes the
// channel -- as soon as ctx is cancelled (client disconnected) or the body
// ends, so no goroutine outlives the request.
func (c *DomainClient) StreamActivity(ctx context.Context) (<-chan domain.AgentRunEvent, error) {
	if c == nil {
		return nil, ErrNotConfigured
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+withTenant("/agent/activity", c.tenantFor(ctx)), nil)
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
	// is a server-side concern, folded into the payload here.
	//
	// Precedence: a real end-user SESSION always wins (the caller's own tenant
	// is not negotiable — security). The OPERATOR path (X-API-Key) is a SYSTEM
	// principal (the agent worker uses it): when the payload already carries a
	// tenant_id, that one is honored, so the worker writes to the tenant the
	// domain event belongs to (not the operator's fixed workspace). No tenant
	// in the payload -> fall back to the resolved/operator tenant.
	if m, ok := payload.(map[string]any); ok {
		if tenant := c.publishTenant(ctx, m); tenant != "" {
			m["tenant_id"] = tenant
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
