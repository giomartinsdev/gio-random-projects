// Package domainapi is apostas-resultado-worker's persistence client --
// this service has no database of its own, same pattern as
// proventos-worker's own internal/domainapi (see that package's doc
// comment for the fuller writeup of the /sync-vs-async split). Every
// write here goes through POST /sync: resolving an aposta wrong is
// worse than a slower cycle, so a resolve blocks until domain-worker
// confirms it landed before the worker moves on to crediting a payout
// or the next aposta.
//
// ListPendentes exists only because this worker has no person's
// session to scope a query by -- it sweeps every pending aposta in the
// system once a day, same reasoning as proventos-worker's
// ListTodosAtivos.
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

// ErrQueued is Sync's "gave up waiting" answer (the server's 504). The
// command was published and may still land -- it is not a rejection.
var ErrQueued = errors.New("domain: command still queued (worker did not confirm in time)")

// ErrRejected is Sync's 422: the worker looked at the command and
// refused it (validation, unknown action). Retrying unchanged will fail
// the same way -- this is permanent, unlike ErrQueued.
var ErrRejected = errors.New("domain: command rejected by worker")

// Client talks to domain-api with this service's own API key.
type Client struct {
	base     string
	key      string
	syncHTTP *http.Client
	readHTTP *http.Client
}

// New builds a client. base is the origin (e.g. http://domain-api:8000).
func New(base, key string) *Client {
	return &Client{
		base:     base,
		key:      key,
		syncHTTP: &http.Client{Timeout: 15 * time.Second},
		readHTTP: &http.Client{Timeout: 10 * time.Second},
	}
}

// NewFromEnv wires the client from
// APOSTAS_RESULTADO_WORKER_DOMAIN_API_URL +
// APOSTAS_RESULTADO_WORKER_DOMAIN_API_KEY. Either unset returns nil --
// callers should treat that as "cannot run a cycle" and keep retrying
// on the next tick rather than crash-looping the whole process.
func NewFromEnv() *Client {
	base := os.Getenv("APOSTAS_RESULTADO_WORKER_DOMAIN_API_URL")
	key := os.Getenv("APOSTAS_RESULTADO_WORKER_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// Aposta mirrors one pending bet as domain-api answers GET
// /apostas/pendentes -- field names/tags match the domain-api
// aggregate (internal/domain/aposta.Aposta), snake_case on the wire.
type Aposta struct {
	ID            string    `json:"id"`
	UsuarioEmail  string    `json:"usuario_email"`
	ContaID       string    `json:"conta_id"`
	Descricao     string    `json:"descricao"`
	ValorApostado float64   `json:"valor_apostado"`
	Odd           float64   `json:"odd"`
	Status        string    `json:"status"`
	DataAposta    time.Time `json:"data_aposta"`
}

// resolverInput is the aposta.resolver /sync payload.
type resolverInput struct {
	ApostaID      string  `json:"aposta_id"`
	Status        string  `json:"status"`
	RetornoObtido float64 `json:"retorno_obtido,omitempty"`
	Data          string  `json:"data"`
}

// createTransacaoInput is the transacao.create /sync payload.
type createTransacaoInput struct {
	UsuarioEmail string  `json:"usuario_email"`
	ContaID      string  `json:"conta_id"`
	Tipo         string  `json:"tipo"`
	Categoria    string  `json:"categoria"`
	Descricao    string  `json:"descricao"`
	Valor        float64 `json:"valor"`
	Data         string  `json:"data"`
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

const dateLayout = "2006-01-02"

// ListPendentes is GET /apostas/pendentes -- every aposta still
// awaiting a result, across every person, the worker's one entry point
// into "what could still be resolved today".
func (c *Client) ListPendentes(ctx context.Context) ([]Aposta, error) {
	var out struct {
		Apostas []Aposta `json:"apostas"`
	}
	if err := c.get(ctx, "/apostas/pendentes", &out); err != nil {
		return nil, err
	}
	return out.Apostas, nil
}

// ResolverAposta publishes aposta.resolver and blocks until
// domain-worker confirms it landed. status is "green", "red" or
// "cancelada"; retornoObtido is only meaningful for "green".
func (c *Client) ResolverAposta(ctx context.Context, apostaID, status string, retornoObtido float64, data time.Time) error {
	_, err := c.sync(ctx, "aposta.resolver", resolverInput{
		ApostaID: apostaID, Status: status, RetornoObtido: retornoObtido, Data: data.Format(dateLayout),
	})
	return err
}

// CreditarRetorno publishes transacao.create (an "entrada" in the
// "aposta" categoria) and blocks until domain-worker confirms it landed
// -- the actual money credit into the person's conta for a green (or a
// refund for a cancelada).
func (c *Client) CreditarRetorno(ctx context.Context, usuarioEmail, contaID, descricao string, valor float64, data time.Time) error {
	_, err := c.sync(ctx, "transacao.create", createTransacaoInput{
		UsuarioEmail: usuarioEmail, ContaID: contaID, Tipo: "entrada", Categoria: "aposta",
		Descricao: descricao, Valor: valor, Data: data.Format(dateLayout),
	})
	return err
}

func (c *Client) sync(ctx context.Context, action string, payload any) (string, error) {
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
		return fmt.Errorf("domain: GET %s: status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(out); err != nil {
		return fmt.Errorf("domain: decode GET %s: %w", path, err)
	}
	return nil
}
