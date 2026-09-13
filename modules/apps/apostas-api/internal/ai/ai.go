// Package ai reads a betting-slip screenshot and extracts the bet's
// shape (casa, descrição, valor apostado, odd) via a vision-capable
// model -- the same OpenAI-compatible chat-completions shape
// cch-api's own internal/ai uses for its deck-forge writer, talking to
// the homelab's own 9router (REQUIRE_API_KEY=false on the internal
// network, so no provider key lives in this codebase). The one real
// difference from cch-api's client: the user message carries a
// multimodal content array (text + image_url) instead of a plain
// string, and APOSTAS_AI_MODEL must name a model that actually accepts
// images -- auto-discovery here has no way to tell a vision model from
// a text-only one, so an operator who leaves this unset is trusting
// whatever 9router picks first.
package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const requestTimeout = 60 * time.Second

const (
	envBaseURL = "APOSTAS_AI_BASE_URL"
	envAPIKey  = "APOSTAS_AI_API_KEY"
	envModel   = "APOSTAS_AI_MODEL"
)

// Client is safe for concurrent use. A nil *Client is valid and simply
// disabled.
type Client struct {
	base   string
	key    string
	models []string
	hc     *http.Client

	mu         sync.Mutex
	model      string
	tried      bool
	discovered []string
}

// New builds a client against a proxy root (e.g.
// http://9router:20128/v1). An empty base URL means disabled.
func New(baseURL, apiKey string, models []string) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return nil
	}
	c := &Client{base: base, key: strings.TrimSpace(apiKey), hc: &http.Client{Timeout: requestTimeout}}
	for _, m := range models {
		if m = strings.TrimSpace(m); m != "" {
			c.models = append(c.models, m)
		}
	}
	return c
}

// NewFromEnv reads APOSTAS_AI_BASE_URL/APOSTAS_AI_API_KEY/APOSTAS_AI_MODEL.
// An unset base URL means disabled.
func NewFromEnv() *Client {
	base := strings.TrimSpace(os.Getenv(envBaseURL))
	if base == "" {
		return nil
	}
	return New(base, os.Getenv(envAPIKey), strings.Split(os.Getenv(envModel), ","))
}

// Enabled reports whether there is anywhere to send the screenshot.
func (c *Client) Enabled() bool { return c != nil && c.base != "" }

// Extracao is the parsed answer: what the model read off the
// screenshot. Odd is 0 when the model couldn't find one -- the caller
// treats that as "no odd", not an error.
type Extracao struct {
	Casa          string  `json:"casa"`
	Descricao     string  `json:"descricao"`
	ValorApostado float64 `json:"valorApostado"`
	Odd           float64 `json:"odd"`
}

// ErrNaoConfigurada is returned when no client is wired up.
var ErrNaoConfigurada = errors.New("IA não configurada neste servidor")

// LerAposta sends the screenshot (raw PNG/JPEG bytes) to the vision
// model and returns the extracted bet shape.
func (c *Client) LerAposta(ctx context.Context, imagem []byte, mimeType string) (Extracao, error) {
	if !c.Enabled() {
		return Extracao{}, ErrNaoConfigurada
	}
	models := c.candidateModels(ctx)
	if len(models) == 0 {
		return Extracao{}, errors.New("nenhum modelo de IA disponível -- defina APOSTAS_AI_MODEL")
	}

	dataURL := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(imagem)
	content := []map[string]any{
		{"type": "text", "text": buildPrompt()},
		{"type": "image_url", "image_url": map[string]string{"url": dataURL}},
	}
	basePayload, _ := json.Marshal(map[string]any{
		"temperature": 0.0,
		"max_tokens":  512,
		"messages":    []map[string]any{{"role": "user", "content": content}},
	})
	buildPayload := func(model string) []byte {
		var m map[string]any
		_ = json.Unmarshal(basePayload, &m)
		m["model"] = model
		out, _ := json.Marshal(m)
		return out
	}

	var lastErr error
	for _, model := range models {
		extracao, err := c.chat(ctx, buildPayload(model))
		if err == nil {
			c.rememberModel(model)
			return extracao, nil
		}
		if !isModelErr(err) {
			return Extracao{}, err
		}
		lastErr = err
	}
	return Extracao{}, lastErr
}

func (c *Client) chat(ctx context.Context, payload []byte) (Extracao, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return Extracao{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}

	res, err := c.hc.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return Extracao{}, errors.New("a IA demorou demais para responder")
		}
		return Extracao{}, errors.New("não foi possível falar com a IA")
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return Extracao{}, errors.New("resposta da IA ilegível")
	}
	if res.StatusCode != http.StatusOK {
		if isModelStatus(res.StatusCode) {
			return Extracao{}, modelError{status: res.StatusCode}
		}
		return Extracao{}, fmt.Errorf("a IA recusou o pedido (HTTP %d)", res.StatusCode)
	}

	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &completion); err != nil || len(completion.Choices) == 0 {
		return Extracao{}, errors.New("resposta da IA em formato inesperado")
	}
	return parseExtracao(completion.Choices[0].Message.Content)
}

func (c *Client) candidateModels(ctx context.Context) []string {
	if len(c.models) > 0 {
		return c.models
	}
	c.mu.Lock()
	if c.tried {
		models := c.discovered
		c.mu.Unlock()
		return models
	}
	c.mu.Unlock()

	models := c.discoverModels(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tried = true
	c.discovered = models
	return models
}

// discoverModels asks the proxy for its model list -- with no way to
// tell a vision model from a text-only one, this just takes the first
// listed. An operator who cares should set APOSTAS_AI_MODEL explicitly
// to a known vision-capable model instead of relying on this.
func (c *Client) discoverModels(ctx context.Context) []string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/models", nil)
	if err != nil {
		return nil
	}
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
	res, err := c.hc.Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil
	}

	var listing struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&listing); err != nil {
		return nil
	}
	if len(listing.Data) == 0 {
		return nil
	}
	names := make([]string, 0, len(listing.Data))
	for _, m := range listing.Data {
		if m.ID != "" {
			names = append(names, m.ID)
		}
	}
	if len(names) == 0 {
		return nil
	}
	return names[:1]
}

func (c *Client) rememberModel(m string) {
	c.mu.Lock()
	c.model = m
	c.mu.Unlock()
}

type modelError struct{ status int }

func (e modelError) Error() string { return fmt.Sprintf("modelo indisponível (HTTP %d)", e.status) }

func isModelStatus(status int) bool {
	switch status {
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden,
		http.StatusNotFound, http.StatusUnprocessableEntity:
		return true
	}
	return false
}

func isModelErr(err error) bool {
	var me modelError
	return errors.As(err, &me)
}

// parseExtracao pulls the JSON out of the model's answer -- models like
// to wrap answers in prose or fenced code despite instructions.
func parseExtracao(content string) (Extracao, error) {
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		return Extracao{}, errors.New("a IA não devolveu um JSON")
	}
	var raw Extracao
	if err := json.Unmarshal([]byte(content[start:end+1]), &raw); err != nil {
		return Extracao{}, errors.New("a IA não devolveu um JSON válido")
	}
	raw.Casa = strings.TrimSpace(raw.Casa)
	raw.Descricao = strings.TrimSpace(raw.Descricao)
	return raw, nil
}

func buildPrompt() string {
	return `Você lê capturas de tela de apostas esportivas de casas de aposta (Bet365, Betano, KTO, etc.) e extrai os dados da aposta feita.

Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, no formato exato:
{"casa":"nome da casa de aposta","descricao":"o que foi apostado (times/mercado)","valorApostado":0,"odd":0}

- "casa": o nome da casa de apostas visível na imagem (ex.: "Bet365", "Betano", "KTO").
- "descricao": um resumo curto do que foi apostado (ex.: "Real Madrid vence", "Over 2.5 gols").
- "valorApostado": o valor em reais apostado, como número (ex.: 50.00), sem símbolo de moeda.
- "odd": a cotação/odd da aposta, como número (ex.: 1.85). Se não conseguir identificar, use 0.

Se não conseguir identificar algum campo com confiança, ainda assim responda com o JSON, deixando o campo vazio ("") ou zero (0) -- nunca invente um valor.`
}
