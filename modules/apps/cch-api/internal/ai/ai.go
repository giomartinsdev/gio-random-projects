// Package ai is the deck forge's writer: a small OpenAI-compatible
// chat-completions client that turns "one existing deck + a free-form
// theme" into a draft deck of new cards. In production it talks to the
// homelab's own 9router (ai.giomartins.dev on the VPS's loopback,
// REQUIRE_API_KEY=false) -- which means no provider key lives in this
// codebase, and the feature costs nothing to configure. Point
// CCH_AI_BASE_URL anywhere else OpenAI-compatible and it just works.
//
// The client is deliberately transport-only smart: one system prompt
// (the content contract lives there, in Portuguese, next to the decks
// package's own policy comment), one JSON answer, lenient parsing. The
// AI drafts; the human refines -- every draft goes through the Forja's
// editor before it can be published, so a sloppy answer is a bad first
// page, never a shipped deck.
package ai

import (
	"bytes"
	"context"
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

const (
	// One generation writes ~40 short cards. 4096 tokens covers it with
	// headroom; the provider-side fallback in 9router makes a single
	// attempt occasionally slow, so the budget is generous but finite.
	requestTimeout = 120 * time.Second

	maxDraftWhites = 150
	maxDraftBlacks = 50
	maxCardLen     = 200
	maxNameLen     = 40
	maxDescLen     = 160
)

// Env vars. CCH_AI_MODEL takes a comma-separated list -- each is tried
// in order and the first that answers wins (and sticks for the process
// lifetime). Empty means "ask the proxy for its model list and pick a
// small one", so a default 9router install works with zero config.
const (
	envBaseURL = "CCH_AI_BASE_URL"
	envAPIKey  = "CCH_AI_API_KEY"
	envModel   = "CCH_AI_MODEL"
)

// Client is safe for concurrent use. A nil *Client is valid and simply
// disabled -- main.go builds one unconditionally.
type Client struct {
	base string
	key  string
	// models is the explicit CCH_AI_MODEL list; empty means auto-discover.
	models []string

	hc *http.Client

	mu    sync.Mutex
	model string // the model that last worked; sticky
	tried bool   // auto-discovery already happened

	// discovered is the auto-picked model list from the one-time
	// /v1/models lookup (nil until it runs).
	discovered []string
}

// New builds a client against a proxy root (e.g. http://127.0.0.1:20128/v1).
// An empty base URL means disabled; models is the explicit candidate list
// (empty means auto-discover from the proxy).
func New(baseURL, apiKey string, models []string) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return nil
	}
	c := &Client{
		base: base,
		key:  strings.TrimSpace(apiKey),
		hc:   &http.Client{Timeout: requestTimeout},
	}
	for _, m := range models {
		if m = strings.TrimSpace(m); m != "" {
			c.models = append(c.models, m)
		}
	}
	return c
}

// NewFromEnv reads the forge's configuration. An unset base URL means
// disabled: local dev without a proxy keeps every non-AI path working.
func NewFromEnv() *Client {
	base := strings.TrimSpace(os.Getenv(envBaseURL))
	if base == "" {
		return nil
	}
	return New(base, os.Getenv(envAPIKey), strings.Split(os.Getenv(envModel), ","))
}

// Enabled reports whether the forge has anywhere to send prompts.
func (c *Client) Enabled() bool { return c != nil && c.base != "" }

// BaseURL is the configured proxy root, for boot logs and status.
func (c *Client) BaseURL() string {
	if c == nil {
		return ""
	}
	return c.base
}

// Model is the currently chosen model, for status endpoints and logs.
func (c *Client) Model() string {
	if c == nil {
		return ""
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.model
}

// GenInput describes one draft request: the parent deck's identity and
// a tone sample, plus the free-form theme.
type GenInput struct {
	ParentName        string
	ParentDescription string
	SampleWhites      []string // a handful of the parent's cards, as tone examples
	SampleBlacks      []string
	Theme             string
}

// Draft is the parsed answer: a deck the Forja editor can take as-is.
type Draft struct {
	Name        string   `json:"name"`
	Emoji       string   `json:"emoji"`
	Description string   `json:"description"`
	Whites      []string `json:"whites"`
	Blacks      []string `json:"blacks"`
}

// Generate asks for a themed draft. Errors are written to be shown in
// the Forja verbatim.
func (c *Client) Generate(ctx context.Context, in GenInput) (Draft, error) {
	if !c.Enabled() {
		return Draft{}, errors.New("IA não configurada neste servidor")
	}

	models := c.candidateModels(ctx)
	if len(models) == 0 {
		return Draft{}, errors.New("nenhum modelo de IA disponível -- defina CCH_AI_MODEL")
	}

	system := buildSystemPrompt()
	user := buildUserPrompt(in)
	basePayload, _ := json.Marshal(map[string]any{
		"temperature": 1.0,
		"max_tokens":  4096,
		"messages": []map[string]string{
			{"role": "system", "content": system},
			{"role": "user", "content": user},
		},
	})
	// The model goes into each attempt's payload individually -- the
	// cascade swaps exactly this field between tries.
	buildPayload := func(model string) []byte {
		var m map[string]any
		_ = json.Unmarshal(basePayload, &m)
		m["model"] = model
		out, _ := json.Marshal(m)
		return out
	}

	// Cascade: each candidate model gets one shot at a 4xx (wrong name,
	// wrong plan). 429 and 5xx are provider conditions, not model
	// conditions -- cascading there would just multiply load.
	var lastErr error
	for _, model := range models {
		draft, err := c.chat(ctx, model, buildPayload(model))
		if err == nil {
			c.rememberModel(model)
			return draft, nil
		}
		if !isModelErr(err) {
			return Draft{}, err
		}
		lastErr = err
	}
	return Draft{}, lastErr
}

// chat posts one chat-completions request and parses the answer.
func (c *Client) chat(ctx context.Context, model string, payload []byte) (Draft, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return Draft{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}

	res, err := c.hc.Do(req)
	if err != nil {
		// Distinguish timeouts so the UI can say something honest.
		if errors.Is(err, context.DeadlineExceeded) {
			return Draft{}, errors.New("a IA demorou demais para responder, tente de novo")
		}
		return Draft{}, errors.New("não foi possível falar com a IA")
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return Draft{}, errors.New("resposta da IA ilegível")
	}
	if res.StatusCode != http.StatusOK {
		if isModelStatus(res.StatusCode) {
			return Draft{}, modelError{status: res.StatusCode, body: string(body)}
		}
		return Draft{}, fmt.Errorf("a IA recusou o pedido (HTTP %d)", res.StatusCode)
	}

	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &completion); err != nil || len(completion.Choices) == 0 {
		return Draft{}, errors.New("resposta da IA em formato inesperado")
	}

	draft, err := parseDraft(completion.Choices[0].Message.Content)
	if err != nil {
		return Draft{}, err
	}
	return draft, nil
}

// candidateModels resolves which models to try, in order: the explicit
// env list, else a one-time discovery against the proxy's /v1/models.
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

// discoverModels asks the proxy for its list and picks a small, cheap
// model first -- card writing needs wit, not frontier reasoning. The
// prefixes and tiers vary by install (9router names look like
// "cc/claude-…"), so this is a preference order, not a contract; the
// explicit CCH_AI_MODEL list always wins when set.
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

	names := make([]string, 0, len(listing.Data))
	for _, m := range listing.Data {
		if m.ID != "" {
			names = append(names, m.ID)
		}
	}
	if len(names) == 0 {
		return nil
	}

	pick := func(needle string) string {
		for _, n := range names {
			if strings.Contains(strings.ToLower(n), needle) {
				return n
			}
		}
		return ""
	}
	preferred := []string{"haiku", "mini", "flash", "lite"}
	for _, needle := range preferred {
		if m := pick(needle); m != "" {
			return []string{m}
		}
	}
	// Nothing small-sounding: take the first listed and let the cascade
	// fall through if the proxy rejects it.
	return names[:1]
}

func (c *Client) rememberModel(m string) {
	c.mu.Lock()
	c.model = m
	c.mu.Unlock()
}

// modelError marks "this model name doesn't work here" -- the cascade's
// signal, and never the caller's error text (the next model may just
// succeed).
type modelError struct {
	status int
	body   string
}

func (e modelError) Error() string {
	return fmt.Sprintf("modelo indisponível (HTTP %d)", e.status)
}

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

// parseDraft pulls the JSON out of a chat answer. Models like to wrap
// answers in prose or fenced code despite instructions -- the first {
// to the last } bracket whatever JSON is in there, and everything is
// re-sanitized afterwards anyway (the publish path validates for real).
func parseDraft(content string) (Draft, error) {
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		return Draft{}, errors.New("a IA não devolveu um deck em JSON")
	}

	var raw struct {
		Name        string   `json:"name"`
		Emoji       string   `json:"emoji"`
		Description string   `json:"description"`
		Whites      []string `json:"whites"`
		Blacks      []string `json:"blacks"`
	}
	if err := json.Unmarshal([]byte(content[start:end+1]), &raw); err != nil {
		return Draft{}, errors.New("a IA não devolveu um deck em JSON válido")
	}

	draft := Draft{
		Name:        trimRunes(raw.Name, maxNameLen),
		Emoji:       strings.TrimSpace(raw.Emoji),
		Description: trimRunes(raw.Description, maxDescLen),
		Whites:      sanitizeLines(raw.Whites, maxCardLen, maxDraftWhites),
		Blacks:      sanitizeLines(raw.Blacks, maxCardLen, maxDraftBlacks),
	}
	if len(draft.Whites) == 0 || len(draft.Blacks) == 0 {
		return Draft{}, errors.New("a IA devolveu um deck vazio")
	}
	return draft, nil
}

// buildSystemPrompt is the forge's writer-instruction sheet: tone
// guidance from the decks package's content contract, the JSON schema,
// and the counts a deck needs to be publishable.
func buildSystemPrompt() string {
	return `Você escreve cartas para um jogo brasileiro estilo Cards Against Humanity.

Você recebe a essência de um deck existente (cartas de exemplo), um tema livre, e escreve um deck NOVO amplificado: cartas inéditas, no mesmo espírito do deck base, todas girando em torno do tema.

Regras de conteúdo (obrigatórias):
- Humor pesado é o ponto: morte, azar, crime, tabu, vergonha, absurdo e desesperança.
- Português do Brasil, frases curtas e diretas (de 2 a 12 palavras por carta branca).
- NUNCA: piada cujo alvo seja um grupo étnico, religioso ou povo; nada sexual envolvendo menores; nenhuma pessoa real citada pelo nome -- use papéis ("o gerente", "a influencer", "o tio").
- Marcas e situações brasileiras genéricas são bem-vindas (Pix, boleto, grupo de família).
- Cada carta branca é uma RESPOSTA curta. Cada carta preta é uma FRASE com "_" marcando onde a resposta entra (uma ou duas lacunas, nunca zero).

Responda APENAS com JSON válido, sem texto fora dele, no formato exato:
{"name":"nome do deck","emoji":"um emoji","description":"uma frase curta sobre o deck","whites":["...","..."],"blacks":["...","..."]}

Quantidades: exatamente 30 cartas em "whites" e exatamente 8 em "blacks".`
}

// buildUserPrompt frames the request with the parent deck's tone sample
// and the theme.
func buildUserPrompt(in GenInput) string {
	var b strings.Builder
	b.WriteString("Deck base: " + in.ParentName)
	if in.ParentDescription != "" {
		b.WriteString(" -- " + in.ParentDescription)
	}
	b.WriteString("\n\nCartas de exemplo do deck base (mesmo espírito, não copiar):\n")
	for _, w := range in.SampleWhites {
		b.WriteString("- " + w + "\n")
	}
	for _, b2 := range in.SampleBlacks {
		b.WriteString("- " + b2 + "\n")
	}
	theme := strings.TrimSpace(in.Theme)
	if theme == "" {
		b.WriteString("\nTema: amplificação livre -- mais das mesmas energias, cartas novas e ainda mais pesadas.")
	} else {
		b.WriteString("\nTema do novo deck: " + theme)
	}
	return b.String()
}

// sanitizeLines trims, drops empties and duplicates, caps each line's
// length and the list's total -- the AI's raw output never reaches a
// player or the store unbounded.
func sanitizeLines(lines []string, maxLen, maxCount int) []string {
	out := make([]string, 0, len(lines))
	seen := make(map[string]bool, len(lines))
	for _, l := range lines {
		l = trimRunes(l, maxLen)
		if l == "" || seen[l] {
			continue
		}
		seen[l] = true
		out = append(out, l)
		if len(out) >= maxCount {
			break
		}
	}
	return out
}

// trimRunes trims whitespace and bounds by runes (never splitting a
// multi-byte character) -- same discipline as httpapi.sanitizeName.
func trimRunes(raw string, max int) string {
	s := strings.TrimSpace(raw)
	r := []rune(s)
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}