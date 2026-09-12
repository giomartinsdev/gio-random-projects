// Package domainapi is asset-manager-api's persistence client. This
// service has no database of its own for positions -- every durable
// write and read goes through the platform's shared domain-api, same
// pattern as cch-api's internal/domainapi. Two write shapes, kept
// deliberately separate:
//
//   - Sync: POST /sync, which blocks until the domain-worker's audit
//     row proves the write landed. Used for the structural writes
//     (ativo.create, ativo.registerMovement) where "the position/
//     movement exists" must survive a restart seconds later.
//   - The quote update (POST /ativos/{id}/cotacao) is a dedicated,
//     fire-and-forget async route -- NOT /sync -- since it is a
//     background refresh triggered by asset-manager-api itself, not a
//     person waiting on the response. A 202 is success; a dropped quote
//     update only makes the persisted "last known price" a bit stale,
//     which FR-035's fallback already tolerates.
//
// Reads (GET /ativos, GET /ativos/{id}/movimentos) hit the network on
// every call -- unlike cch-api's boot-time load, positions can change
// out from under this service (another device, another tab) so there
// is no in-memory mirror to keep warm.
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

// Client talks to domain-api with this service's own API key. A nil
// Client is valid and means "no persistence configured" -- every method
// short-circuits, matching cch-api's nil-client convention.
type Client struct {
	base string
	key  string
	// syncHTTP allows for the server's own wait plus round-trips;
	// asyncHTTP bounds the fire-and-forget quote-update path so a
	// wedged domain-api can't pile up goroutines; readHTTP bounds the
	// GET /ativos and GET /ativos/{id}/movimentos calls.
	syncHTTP  *http.Client
	asyncHTTP *http.Client
	readHTTP  *http.Client
}

// New builds a client. base is the origin (e.g. http://127.0.0.1:8000).
func New(base, key string) *Client {
	return &Client{
		base:      base,
		key:       key,
		syncHTTP:  &http.Client{Timeout: 15 * time.Second},
		asyncHTTP: &http.Client{Timeout: 5 * time.Second},
		readHTTP:  &http.Client{Timeout: 10 * time.Second},
	}
}

// NewFromEnv wires the client from ASSET_MANAGER_DOMAIN_API_URL +
// ASSET_MANAGER_DOMAIN_API_KEY. Either unset (local dev, tests) returns
// nil.
func NewFromEnv() *Client {
	base := os.Getenv("ASSET_MANAGER_DOMAIN_API_URL")
	key := os.Getenv("ASSET_MANAGER_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// Enabled reports whether persistence is wired up.
func (c *Client) Enabled() bool { return c != nil }

// Ativo mirrors one position as domain-api answers GET /ativos and
// GET /ativos/{id}/movimentos's parent -- field names/tags match the
// domain-api aggregate (internal/domain/ativo.Ativo), which speaks
// snake_case on the wire like the rest of that service's DTOs.
type Ativo struct {
	ID              string    `json:"id"`
	UsuarioEmail    string    `json:"usuario_email"`
	ContaID         string    `json:"conta_id"`
	Ticker          string    `json:"ticker"`
	Status          string    `json:"status"`
	QuantidadeAtual float64   `json:"quantidade_atual"`
	CustoMedio      float64   `json:"custo_medio"`
	UltimaCotacao   float64   `json:"ultima_cotacao"`
	UltimaCotacaoEm time.Time `json:"ultima_cotacao_em"`
	CriadoEm        time.Time `json:"criado_em"`
	AtualizadoEm    time.Time `json:"atualizado_em"`
}

// Movimento mirrors one row of an ativo's movement history
// (internal/domain/ativomovimento.AtivoMovimento on domain-api).
type Movimento struct {
	ID                 string    `json:"id"`
	AtivoID            string    `json:"ativo_id"`
	Tipo               string    `json:"tipo"`
	Quantidade         float64   `json:"quantidade"`
	PrecoUnitario      float64   `json:"preco_unitario"`
	ValorProvento      float64   `json:"valor_provento"`
	ResultadoRealizado float64   `json:"resultado_realizado"`
	Data               time.Time `json:"data"`
	CriadoEm           time.Time `json:"criado_em"`
}

// CreateAtivoInput is the ativo.create /sync payload.
type CreateAtivoInput struct {
	UsuarioEmail  string  `json:"usuario_email"`
	ContaID       string  `json:"conta_id"`
	Ticker        string  `json:"ticker"`
	Quantidade    float64 `json:"quantidade"`
	PrecoUnitario float64 `json:"preco_unitario"`
	Data          string  `json:"data"`
}

// RegisterMovementInput is the ativo.registerMovement /sync payload.
type RegisterMovementInput struct {
	AtivoID       string   `json:"ativo_id"`
	UsuarioEmail  string   `json:"usuario_email"`
	Tipo          string   `json:"tipo"`
	Quantidade    *float64 `json:"quantidade,omitempty"`
	PrecoUnitario *float64 `json:"preco_unitario,omitempty"`
	ValorProvento *float64 `json:"valor_provento,omitempty"`
	Data          string   `json:"data"`
}

// CotacaoInput is the POST /ativos/{id}/cotacao async payload.
type CotacaoInput struct {
	Cotacao  float64   `json:"cotacao"`
	ObtidaEm time.Time `json:"obtida_em"`
}

// envelope is the write shape every domain-api /sync call takes.
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

// CreateAtivo publishes ativo.create and blocks until domain-worker
// confirms it. Returns the new ativo's id.
func (c *Client) CreateAtivo(ctx context.Context, in CreateAtivoInput) (string, error) {
	return c.sync(ctx, "ativo.create", in)
}

// RegisterMovement publishes ativo.registerMovement and blocks until
// domain-worker confirms it. Returns the new movement's id.
func (c *Client) RegisterMovement(ctx context.Context, in RegisterMovementInput) (string, error) {
	return c.sync(ctx, "ativo.registerMovement", in)
}

func (c *Client) sync(ctx context.Context, action string, payload any) (string, error) {
	if c == nil {
		return "", errors.New("domain: client not configured")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("domain: marshal %s payload: %w", action, err)
	}
	body, status, err := c.post(ctx, c.syncHTTP, "/sync", envelope{Action: action, Payload: raw})
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

// AtualizarCotacao is the fire-and-forget quote persist: POST
// /ativos/{id}/cotacao, expecting 202. Called from the GET /api/ativos
// flow whenever a quote came back fresh from brapi.dev (not from the
// in-memory cache) -- never blocks the person waiting on the response,
// so callers may run it synchronously right there without harming
// latency meaningfully, or in a goroutine; either is fine.
func (c *Client) AtualizarCotacao(ctx context.Context, ativoID string, in CotacaoInput) error {
	if c == nil {
		return nil
	}
	_, status, err := c.post(ctx, c.asyncHTTP, "/ativos/"+url.PathEscape(ativoID)+"/cotacao", in)
	if err != nil {
		return err
	}
	if status != http.StatusAccepted {
		return fmt.Errorf("domain: POST cotacao for %s: status %d", ativoID, status)
	}
	return nil
}

// ListAtivos is GET /ativos?usuario=&conta= -- the positions of one
// person, optionally scoped to a single conta.
func (c *Client) ListAtivos(ctx context.Context, usuarioEmail, contaID string) ([]Ativo, error) {
	if c == nil {
		return nil, errors.New("domain: client not configured")
	}
	q := url.Values{}
	q.Set("usuario", usuarioEmail)
	if contaID != "" {
		q.Set("conta", contaID)
	}
	var out struct {
		Ativos []Ativo `json:"ativos"`
	}
	if err := c.get(ctx, "/ativos?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Ativos, nil
}

// ListMovimentos is GET /ativos/{id}/movimentos -- one ativo's history.
func (c *Client) ListMovimentos(ctx context.Context, ativoID string) ([]Movimento, error) {
	if c == nil {
		return nil, errors.New("domain: client not configured")
	}
	var out struct {
		Movimentos []Movimento `json:"movimentos"`
	}
	if err := c.get(ctx, "/ativos/"+url.PathEscape(ativoID)+"/movimentos", &out); err != nil {
		return nil, err
	}
	return out.Movimentos, nil
}

// post sends one body to path and returns the raw body + status. A
// transport error surfaces as-is; HTTP error statuses are returned to
// the caller to classify.
func (c *Client) post(ctx context.Context, client *http.Client, path string, body any) ([]byte, int, error) {
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

	resp, err := client.Do(req)
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
		return fmt.Errorf("domain: GET %s: status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out); err != nil {
		return fmt.Errorf("domain: decode GET %s: %w", path, err)
	}
	return nil
}
