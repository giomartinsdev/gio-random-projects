// Package domainapi is proventos-worker's persistence client -- this
// service has no database of its own, same pattern as every other
// finance module's own internal/domainapi (see asset-manager-api's for
// the fuller writeup of the /sync-vs-async split). Every write here
// goes through POST /sync: a missed provento credit is worse than a
// slower cycle, so every write blocks until domain-worker confirms it
// landed before this worker moves on to the next dividend event.
//
// The two cross-user reads (ListTodosAtivos, and the existing-write
// checks used for idempotency) exist only because this worker has no
// person's session to scope a query by -- it sweeps every position in
// the system once a day.
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

// NewFromEnv wires the client from PROVENTOS_WORKER_DOMAIN_API_URL +
// PROVENTOS_WORKER_DOMAIN_API_KEY. Either unset returns nil -- callers
// should treat that as "cannot run a cycle" and keep retrying on the
// next tick rather than crash-looping the whole process.
func NewFromEnv() *Client {
	base := os.Getenv("PROVENTOS_WORKER_DOMAIN_API_URL")
	key := os.Getenv("PROVENTOS_WORKER_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// Ativo mirrors one open position as domain-api answers GET
// /ativos/todos -- field names/tags match the domain-api aggregate
// (internal/domain/ativo.Ativo), snake_case on the wire.
type Ativo struct {
	ID              string  `json:"id"`
	UsuarioEmail    string  `json:"usuario_email"`
	ContaID         string  `json:"conta_id"`
	Ticker          string  `json:"ticker"`
	QuantidadeAtual float64 `json:"quantidade_atual"`
}

// Movimento mirrors one row of an ativo's movement history.
type Movimento struct {
	Tipo          string    `json:"tipo"`
	ValorProvento float64   `json:"valor_provento"`
	Data          time.Time `json:"data"`
}

// Transacao mirrors one row of a conta's transaction history -- only
// the fields the dedupe check needs.
type Transacao struct {
	Descricao string    `json:"descricao"`
	Data      time.Time `json:"data"`
}

// registerMovementInput is the ativo.registerMovement /sync payload.
// usuario_email is deliberately absent: domain-worker looks the ativo
// up by id and never reads it off this envelope (see
// domain-worker's application/ativo.Service.RegisterMovement).
type registerMovementInput struct {
	AtivoID       string  `json:"ativo_id"`
	Tipo          string  `json:"tipo"`
	ValorProvento float64 `json:"valor_provento,omitempty"`
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

// ListTodosAtivos is GET /ativos/todos -- every open position across
// every person, the worker's one entry point into "what could still be
// owed a dividend".
func (c *Client) ListTodosAtivos(ctx context.Context) ([]Ativo, error) {
	var out struct {
		Ativos []Ativo `json:"ativos"`
	}
	if err := c.get(ctx, "/ativos/todos", &out); err != nil {
		return nil, err
	}
	return out.Ativos, nil
}

// ListMovimentos is GET /ativos/{id}/movimentos -- used to check
// whether a given dividend's payment date was already recorded on this
// ativo before registering it again.
func (c *Client) ListMovimentos(ctx context.Context, ativoID string) ([]Movimento, error) {
	var out struct {
		Movimentos []Movimento `json:"movimentos"`
	}
	if err := c.get(ctx, "/ativos/"+url.PathEscape(ativoID)+"/movimentos", &out); err != nil {
		return nil, err
	}
	return out.Movimentos, nil
}

// ListTransacoes is GET /transacoes?usuario=&conta=&de=&ate= -- used to
// check whether a given dividend was already credited to the conta
// before creating another transação for it. de/ate are inclusive
// calendar dates.
func (c *Client) ListTransacoes(ctx context.Context, usuarioEmail, contaID string, dia time.Time) ([]Transacao, error) {
	q := url.Values{}
	q.Set("usuario", usuarioEmail)
	q.Set("conta", contaID)
	q.Set("de", dia.Format(dateLayout))
	q.Set("ate", dia.Format(dateLayout))
	var out struct {
		Transacoes []Transacao `json:"transacoes"`
	}
	if err := c.get(ctx, "/transacoes?"+q.Encode(), &out); err != nil {
		return nil, err
	}
	return out.Transacoes, nil
}

// RegistrarProvento publishes ativo.registerMovement (tipo "provento")
// and blocks until domain-worker confirms it landed.
func (c *Client) RegistrarProvento(ctx context.Context, ativoID string, valor float64, data time.Time) error {
	_, err := c.sync(ctx, "ativo.registerMovement", registerMovementInput{
		AtivoID: ativoID, Tipo: "provento", ValorProvento: valor, Data: data.Format(dateLayout),
	})
	return err
}

// CreditarProvento publishes transacao.create (an "entrada" in the
// "provento" categoria) and blocks until domain-worker confirms it
// landed -- this is the actual money credit into the person's conta.
func (c *Client) CreditarProvento(ctx context.Context, usuarioEmail, contaID, descricao string, valor float64, data time.Time) error {
	_, err := c.sync(ctx, "transacao.create", createTransacaoInput{
		UsuarioEmail: usuarioEmail, ContaID: contaID, Tipo: "entrada", Categoria: "provento",
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
