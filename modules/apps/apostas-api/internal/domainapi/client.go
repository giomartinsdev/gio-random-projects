// Package domainapi is apostas-api's persistence client: this service
// has no database of its own. Two write shapes, deliberately kept
// separate, same reasoning transacional-api's own client documents:
//
//   - Sync: POST /sync, blocking until domain-worker's audit row proves
//     the write landed. Used for aposta.registrar/aposta.resolver --
//     the bet's own record must exist (or be resolved) the instant this
//     call returns, same treatment ativo.create/registerMovement get in
//     asset-manager-api, since the person immediately expects to see it
//     in their list.
//   - The money side (crediting/debiting the conta) rides the shared
//     platform's plain async route -- POST /transacoes, answered 202 --
//     same as every other module's manual transação entry. A brief lag
//     before it shows up in the extrato is the same trade-off
//     transacional-api's own writes already accept.
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

// ErrNotFound is GetConta's answer for a 404.
var ErrNotFound = errors.New("domain: conta não encontrada")

// Client talks to domain-api with this service's own API key.
type Client struct {
	base      string
	key       string
	syncHTTP  *http.Client
	asyncHTTP *http.Client
	readHTTP  *http.Client
}

// New builds a client. base is domain-api's origin (e.g.
// http://domain-api:8000).
func New(base, key string) *Client {
	return &Client{
		base:      base,
		key:       key,
		syncHTTP:  &http.Client{Timeout: 15 * time.Second},
		asyncHTTP: &http.Client{Timeout: 5 * time.Second},
		readHTTP:  &http.Client{Timeout: 10 * time.Second},
	}
}

// NewFromEnv wires the client from APOSTAS_DOMAIN_API_URL +
// APOSTAS_DOMAIN_API_KEY. Either unset returns nil.
func NewFromEnv() *Client {
	base := os.Getenv("APOSTAS_DOMAIN_API_URL")
	key := os.Getenv("APOSTAS_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// Enabled reports whether persistence is wired up.
func (c *Client) Enabled() bool { return c != nil }

// Conta mirrors just the fields apostas-api needs to validate a bet's
// conta (exists, belongs to the caller, is "ativa", is a "aposta"
// wallet).
type Conta struct {
	ID           string `json:"id"`
	UsuarioEmail string `json:"usuario_email"`
	Tipo         string `json:"tipo"`
	Status       string `json:"status"`
}

// Aposta mirrors one bet on the wire, as domain-api answers GET
// /apostas.
type Aposta struct {
	ID            string    `json:"id"`
	UsuarioEmail  string    `json:"usuario_email"`
	ContaID       string    `json:"conta_id"`
	Descricao     string    `json:"descricao"`
	ValorApostado float64   `json:"valor_apostado"`
	Odd           float64   `json:"odd"`
	Status        string    `json:"status"`
	RetornoObtido float64   `json:"retorno_obtido"`
	DataAposta    time.Time `json:"data_aposta"`
	DataResultado time.Time `json:"data_resultado"`
	CriadoEm      time.Time `json:"criado_em"`
	AtualizadoEm  time.Time `json:"atualizado_em"`
}

// RegistrarInput is the aposta.registrar /sync payload.
type RegistrarInput struct {
	UsuarioEmail  string    `json:"usuario_email"`
	ContaID       string    `json:"conta_id"`
	Descricao     string    `json:"descricao"`
	ValorApostado float64   `json:"valor_apostado"`
	Odd           float64   `json:"odd,omitempty"`
	Data          time.Time `json:"data"`
}

// ResolverInput is the aposta.resolver /sync payload.
type ResolverInput struct {
	ApostaID      string    `json:"aposta_id"`
	Status        string    `json:"status"`
	RetornoObtido float64   `json:"retorno_obtido,omitempty"`
	Data          time.Time `json:"data,omitempty"`
}

// CriarTransacaoInput is the async POST /transacoes body.
type CriarTransacaoInput struct {
	UsuarioEmail string  `json:"usuario_email"`
	ContaID      string  `json:"conta_id"`
	Tipo         string  `json:"tipo"`
	Valor        float64 `json:"valor"`
	Data         string  `json:"data"`
	Categoria    string  `json:"categoria"`
	Descricao    string  `json:"descricao,omitempty"`
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

// RegistrarAposta publishes aposta.registrar and blocks until
// domain-worker confirms it. Returns the new aposta's id.
func (c *Client) RegistrarAposta(ctx context.Context, in RegistrarInput) (string, error) {
	return c.sync(ctx, "aposta.registrar", in)
}

// ResolverAposta publishes aposta.resolver and blocks until
// domain-worker confirms it.
func (c *Client) ResolverAposta(ctx context.Context, in ResolverInput) error {
	_, err := c.sync(ctx, "aposta.resolver", in)
	return err
}

func (c *Client) sync(ctx context.Context, action string, payload any) (string, error) {
	if c == nil {
		return "", errors.New("domain: client not configured")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("domain: marshal %s payload: %w", action, err)
	}
	body, status, err := c.postRaw(ctx, c.syncHTTP, "/sync", envelope{Action: action, Payload: raw})
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

// CriarTransacao is the async POST /transacoes write, answered 202 --
// see this package's own doc comment for why this one write skips
// /sync.
func (c *Client) CriarTransacao(ctx context.Context, in CriarTransacaoInput) error {
	if c == nil {
		return errors.New("domain: client not configured")
	}
	_, status, err := c.postRaw(ctx, c.asyncHTTP, "/transacoes", in)
	if err != nil {
		return err
	}
	if status != http.StatusAccepted {
		return fmt.Errorf("domain: POST /transacoes: status %d", status)
	}
	return nil
}

// GetConta fetches one conta by id, for validating it exists, belongs
// to the caller and is a live "aposta" wallet before registering a bet
// against it.
func (c *Client) GetConta(ctx context.Context, id string) (Conta, error) {
	if c == nil {
		return Conta{}, errors.New("domain: client not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/contas/"+url.PathEscape(id), nil)
	if err != nil {
		return Conta{}, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.readHTTP.Do(req)
	if err != nil {
		return Conta{}, fmt.Errorf("domain: GET /contas/%s: %w", id, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return Conta{}, ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return Conta{}, fmt.Errorf("domain: GET /contas/%s: status %d", id, resp.StatusCode)
	}
	var conta Conta
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&conta); err != nil {
		return Conta{}, fmt.Errorf("domain: decode GET /contas/%s: %w", id, err)
	}
	return conta, nil
}

// GetAposta is GET /apostas/{id} -- one bet, for the resolver flow to
// confirm ownership/status without fetching the caller's whole list.
// Returns ErrNotFound on a domain-api 404.
func (c *Client) GetAposta(ctx context.Context, id string) (Aposta, error) {
	if c == nil {
		return Aposta{}, errors.New("domain: client not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/apostas/"+url.PathEscape(id), nil)
	if err != nil {
		return Aposta{}, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.readHTTP.Do(req)
	if err != nil {
		return Aposta{}, fmt.Errorf("domain: GET /apostas/%s: %w", id, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return Aposta{}, ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return Aposta{}, fmt.Errorf("domain: GET /apostas/%s: status %d", id, resp.StatusCode)
	}
	var a Aposta
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&a); err != nil {
		return Aposta{}, fmt.Errorf("domain: decode GET /apostas/%s: %w", id, err)
	}
	return a, nil
}

// ListApostas is GET /apostas?usuario=&conta= -- the person's own bets,
// optionally scoped to a single conta.
func (c *Client) ListApostas(ctx context.Context, usuarioEmail, contaID string) ([]Aposta, error) {
	if c == nil {
		return nil, errors.New("domain: client not configured")
	}
	q := url.Values{}
	q.Set("usuario", usuarioEmail)
	if contaID != "" {
		q.Set("conta", contaID)
	}
	var out struct {
		Apostas []Aposta `json:"apostas"`
	}
	if err := c.get(ctx, "/apostas?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Apostas, nil
}

func (c *Client) postRaw(ctx context.Context, client *http.Client, path string, body any) ([]byte, int, error) {
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
