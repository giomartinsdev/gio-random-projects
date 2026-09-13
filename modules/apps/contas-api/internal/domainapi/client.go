// Package domainapi is contas-api's persistence client: this service has
// no database of its own -- every read and write goes through HTTP to
// the shared domain-api, which the domain-worker applies against the
// `contas` aggregate. There is no database driver here and there must
// never be one.
//
// Writes go through POST /sync (not the plain async 202 path): the
// caller needs immediate feedback -- creating/editing/archiving a conta
// is a foreground UI action, and the contract classifies the worker's
// three possible outcomes (written/queued/failed) into HTTP statuses at
// the handler layer. See modules/apps/cch-api/internal/domainapi for the
// pattern this mirrors.
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

// ErrNotFound is domain-api's 404 on a single-entity GET -- the
// referenced entity doesn't exist. (A conta that exists but belongs to
// someone else comes back as data; ownership is the caller's check.)
var ErrNotFound = errors.New("domain: not found")

// ErrRejected is Sync's 422: the worker looked at the command and
// refused it (validation, unknown action). Retrying unchanged will fail
// the same way -- this is permanent, unlike ErrQueued.
var ErrRejected = errors.New("domain: command rejected by worker")

// Client talks to domain-api with this service's own API key (each
// caller gets an identity so the audit log can name it).
type Client struct {
	base string
	key  string
	// syncHTTP allows for the server's own 10s wait plus round-trips;
	// readHTTP bounds plain GETs.
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

// NewFromEnv wires the client from CONTAS_DOMAIN_API_URL +
// CONTAS_DOMAIN_API_KEY. Either unset returns nil.
func NewFromEnv() *Client {
	base, key := os.Getenv("CONTAS_DOMAIN_API_URL"), os.Getenv("CONTAS_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// Enabled reports whether persistence is wired up.
func (c *Client) Enabled() bool { return c != nil }

// Conta mirrors one contas row on the wire.
type Conta struct {
	ID       string `json:"id"`
	Nome     string `json:"nome"`
	Tipo     string `json:"tipo"`
	Status   string `json:"status"`
	Usuario  string `json:"usuario_email"`
	CriadaEm string `json:"criada_em,omitempty"`
}

// CriarInput is the conta.create payload.
type CriarInput struct {
	UsuarioEmail string `json:"usuario_email"`
	Nome         string `json:"nome"`
	Tipo         string `json:"tipo"`
}

// EditarInput is the conta.update payload. Empty fields are omitted so
// a rename doesn't accidentally clear the status, and vice-versa.
type EditarInput struct {
	ID           string `json:"id"`
	UsuarioEmail string `json:"usuario_email"`
	Nome         string `json:"nome,omitempty"`
	Status       string `json:"status,omitempty"`
}

// envelope is the write shape every domain-api route takes.
type envelope struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// syncResponse is /sync's three possible outcomes on one struct.
type syncResponse struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
	EntityID  string `json:"entity_id"`
	Error     string `json:"error"`
}

// Sync publishes action and blocks until the worker's audit row lands.
// Returns the written entity's id. ErrQueued means "published, not yet
// confirmed"; ErrRejected means the worker refused the command.
func (c *Client) Sync(ctx context.Context, action string, payload any) (string, error) {
	if c == nil {
		return "", nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("domain: marshal %s payload: %w", action, err)
	}
	body, status, err := c.post(ctx, "/sync", envelope{Action: action, Payload: raw})
	if err != nil {
		return "", err
	}
	var resp syncResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("domain: decode /sync response (status %d): %w", status, err)
	}
	switch {
	case status == http.StatusOK && resp.Status == "written":
		return resp.EntityID, nil
	case status == http.StatusGatewayTimeout || resp.Status == "queued":
		return "", fmt.Errorf("%w: %s", ErrQueued, resp.Error)
	case status == http.StatusUnprocessableEntity || resp.Status == "failed":
		return "", fmt.Errorf("%w: %s", ErrRejected, resp.Error)
	default:
		return "", fmt.Errorf("domain: %s was not written (status %d): %s", action, status, resp.Error)
	}
}

// ListContas is GET /contas?usuario=&status=.
func (c *Client) ListContas(ctx context.Context, usuarioEmail, status string) ([]Conta, error) {
	if c == nil {
		return nil, nil
	}
	q := url.Values{"usuario": {usuarioEmail}}
	if status != "" {
		q.Set("status", status)
	}
	var out struct {
		Contas []Conta `json:"contas"`
	}
	if err := c.get(ctx, "/contas?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Contas, nil
}

// GetConta is GET /contas/{id}. A 404 comes back as ErrNotFound.
func (c *Client) GetConta(ctx context.Context, id string) (Conta, error) {
	var out Conta
	if c == nil {
		return out, nil
	}
	if err := c.get(ctx, "/contas/"+url.PathEscape(id), &out); err != nil {
		return out, err
	}
	return out, nil
}

// Transacao mirrors one transacoes row for the saldo aggregation --
// only the fields the math needs (the wire shape is domain-api's
// snake_case DTO).
type Transacao struct {
	Tipo  string  `json:"tipo"`
	Valor float64 `json:"valor"`
}

// Ativo mirrors one position for the saldo aggregation.
type Ativo struct {
	QuantidadeAtual float64 `json:"quantidade_atual"`
	CustoMedio      float64 `json:"custo_medio"`
	UltimaCotacao   float64 `json:"ultima_cotacao"`
}

// ListTransacoes is GET /transacoes?usuario=&conta= -- the lançamentos
// of one conta, what the saldo of a corrente account sums over.
func (c *Client) ListTransacoes(ctx context.Context, usuarioEmail, contaID string) ([]Transacao, error) {
	if c == nil {
		return nil, nil
	}
	q := url.Values{"usuario": {usuarioEmail}, "conta": {contaID}}
	var out struct {
		Transacoes []Transacao `json:"transacoes"`
	}
	if err := c.get(ctx, "/transacoes?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Transacoes, nil
}

// ListAtivos is GET /ativos?usuario=&conta= -- the posições of one
// conta, what the saldo of an investimento account sums over.
func (c *Client) ListAtivos(ctx context.Context, usuarioEmail, contaID string) ([]Ativo, error) {
	if c == nil {
		return nil, nil
	}
	q := url.Values{"usuario": {usuarioEmail}, "conta": {contaID}}
	var out struct {
		Ativos []Ativo `json:"ativos"`
	}
	if err := c.get(ctx, "/ativos?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Ativos, nil
}

// post sends one JSON body to path and returns the body + status. A
// transport error surfaces as-is; HTTP error statuses are returned to
// the caller for classification.
func (c *Client) post(ctx context.Context, path string, body any) ([]byte, int, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, 0, fmt.Errorf("domain: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(raw))
	if err != nil {
		return nil, 0, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.syncHTTP.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("domain: POST %s: %w", path, err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("domain: read POST %s response: %w", path, err)
	}
	return data, resp.StatusCode, nil
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.readHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("domain: GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusNotFound {
			return fmt.Errorf("%w: GET %s", ErrNotFound, path)
		}
		return fmt.Errorf("domain: GET %s: status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out); err != nil {
		return fmt.Errorf("domain: decode GET %s: %w", path, err)
	}
	return nil
}
