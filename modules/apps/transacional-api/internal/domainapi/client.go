// Package domainapi is transacional-api's persistence client: this
// service has no database of its own -- every transação lives in the
// shared domain-api, under the conta/transacao aggregates another team
// is extending in parallel (spec 002-gestao-financeira-modular).
//
// Transação is high volume, so writes go through the plain async
// routes (POST/PATCH/DELETE on /transacoes, answered 202) rather than
// the /sync rendezvous cch-api uses for its structural writes -- a lost
// write here is not acceptable data loss the way a missing room is, but
// waiting on every single lançamento would be needless latency; FR-024
// requires validating the referenced conta up front instead, which is
// what makes this an acceptable trade.
//
// Reads: GET /contas/{id} (existence + status check before a create)
// and GET /transacoes?... (the list endpoint this service's own GET
// /api/transacoes proxies).
package domainapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"
)

// Client talks to domain-api with this service's own API key, which
// (per the shared platform contract) can read any aggregate -- needed
// here to fetch a conta owned by whatever module created it.
type Client struct {
	base string
	key  string
	http *http.Client
}

// New builds a client. base is domain-api's origin (e.g.
// http://127.0.0.1:8000).
func New(base, key string) *Client {
	return &Client{base: base, key: key, http: &http.Client{Timeout: 10 * time.Second}}
}

// NewFromEnv wires the client from TRANSACIONAL_DOMAIN_API_URL +
// TRANSACIONAL_DOMAIN_API_KEY. Either unset returns nil -- callers must
// treat a nil *Client as "persistence unavailable" and fail loudly
// rather than pretend writes succeeded (unlike cch-api's cosmetic
// counters, a transação is the whole point of this service).
func NewFromEnv() *Client {
	base := os.Getenv("TRANSACIONAL_DOMAIN_API_URL")
	key := os.Getenv("TRANSACIONAL_DOMAIN_API_KEY")
	if base == "" || key == "" {
		return nil
	}
	return New(base, key)
}

// Enabled reports whether persistence is wired up.
func (c *Client) Enabled() bool { return c != nil }

// Conta mirrors just the fields transacional-api needs off a conta
// aggregate to validate a lançamento (FR-024's "conta arquivada ou
// inexistente" edge case).
type Conta struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// Transacao mirrors one lançamento on the wire, both for the list
// response and for round-tripping create/update payloads. Valor is a
// JSON number on domain-api (float64 in its DTO) -- sending/expecting a
// string here used to break both the write (400 invalid request body)
// and the read (decode error).
type Transacao struct {
	ID           string  `json:"id"`
	UsuarioEmail string  `json:"usuario_email"`
	ContaID      string  `json:"conta_id"`
	Tipo         string  `json:"tipo"`
	Valor        float64 `json:"valor"`
	Data         string  `json:"data"`
	Categoria    string  `json:"categoria"`
	Descricao    string  `json:"descricao,omitempty"`
	AnexoImagem  string  `json:"anexo_imagem,omitempty"`
}

// CriarInput is the POST /transacoes body. Data must be RFC3339
// (domain-api decodes time.Time); Valor must be a JSON number.
type CriarInput struct {
	UsuarioEmail string  `json:"usuario_email"`
	ContaID      string  `json:"conta_id"`
	Tipo         string  `json:"tipo"`
	Valor        float64 `json:"valor"`
	Data         string  `json:"data"`
	Categoria    string  `json:"categoria"`
	Descricao    string  `json:"descricao,omitempty"`
	AnexoImagem  string  `json:"anexo_imagem,omitempty"`
}

// EditarInput is the PATCH /transacoes/{id} body -- everything but
// UsuarioEmail is optional, so pointers distinguish "not sent" from
// "sent as zero value".
type EditarInput struct {
	UsuarioEmail string   `json:"usuario_email"`
	ContaID      *string  `json:"conta_id,omitempty"`
	Tipo         *string  `json:"tipo,omitempty"`
	Valor        *float64 `json:"valor,omitempty"`
	Data         *string  `json:"data,omitempty"`
	Categoria    *string  `json:"categoria,omitempty"`
	Descricao    *string  `json:"descricao,omitempty"`
	AnexoImagem  *string  `json:"anexo_imagem,omitempty"`
}

// ErrNotFound is GetConta's answer for a 404 -- the caller turns this
// into the contract's conta_invalida, not a 502.
var ErrNotFound = fmt.Errorf("domain: conta não encontrada")

// GetConta fetches one conta by id for the pre-create existence/status
// check (FR-024). Returns ErrNotFound on a domain-api 404.
func (c *Client) GetConta(ctx context.Context, id string) (Conta, error) {
	if c == nil {
		return Conta{}, fmt.Errorf("domain: cliente não configurado")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/contas/"+url.PathEscape(id), nil)
	if err != nil {
		return Conta{}, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.http.Do(req)
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

// ListTransacoes proxies GET /transacoes with this service's own
// filters -- todos opcionais, empty values are simply omitted from the
// query string.
func (c *Client) ListTransacoes(ctx context.Context, usuario, conta, de, ate, categoria string) ([]Transacao, error) {
	if c == nil {
		return nil, fmt.Errorf("domain: cliente não configurado")
	}
	q := url.Values{}
	if usuario != "" {
		q.Set("usuario", usuario)
	}
	if conta != "" {
		q.Set("conta", conta)
	}
	if de != "" {
		q.Set("de", de)
	}
	if ate != "" {
		q.Set("ate", ate)
	}
	if categoria != "" {
		q.Set("categoria", categoria)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/transacoes?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("domain: GET /transacoes: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("domain: GET /transacoes: status %d", resp.StatusCode)
	}

	var out struct {
		Transacoes []Transacao `json:"transacoes"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("domain: decode GET /transacoes: %w", err)
	}
	return out.Transacoes, nil
}

// CriarTransacao is the async POST /transacoes write, answered 202.
func (c *Client) CriarTransacao(ctx context.Context, in CriarInput) error {
	if c == nil {
		return fmt.Errorf("domain: cliente não configurado")
	}
	status, err := c.doJSON(ctx, http.MethodPost, "/transacoes", in)
	if err != nil {
		return err
	}
	if status != http.StatusAccepted {
		return fmt.Errorf("domain: POST /transacoes: status %d", status)
	}
	return nil
}

// EditarTransacao is the async PATCH /transacoes/{id} write.
func (c *Client) EditarTransacao(ctx context.Context, id string, in EditarInput) error {
	if c == nil {
		return fmt.Errorf("domain: cliente não configurado")
	}
	status, err := c.doJSON(ctx, http.MethodPatch, "/transacoes/"+url.PathEscape(id), in)
	if err != nil {
		return err
	}
	if status != http.StatusAccepted {
		return fmt.Errorf("domain: PATCH /transacoes/%s: status %d", id, status)
	}
	return nil
}

// ExcluirTransacao is the async DELETE /transacoes/{id} write, body
// {usuario_email} per the fixed contract.
func (c *Client) ExcluirTransacao(ctx context.Context, id, usuarioEmail string) error {
	if c == nil {
		return fmt.Errorf("domain: cliente não configurado")
	}
	status, err := c.doJSON(ctx, http.MethodDelete, "/transacoes/"+url.PathEscape(id), map[string]string{
		"usuario_email": usuarioEmail,
	})
	if err != nil {
		return err
	}
	if status != http.StatusAccepted {
		return fmt.Errorf("domain: DELETE /transacoes/%s: status %d", id, status)
	}
	return nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any) (int, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return 0, fmt.Errorf("domain: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(raw))
	if err != nil {
		return 0, fmt.Errorf("domain: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-Key", c.key)

	resp, err := c.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("domain: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, nil
}
