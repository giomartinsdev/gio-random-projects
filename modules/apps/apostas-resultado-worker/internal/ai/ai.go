// Package ai does the two text-only reasoning steps the resolver
// worker needs around an aposta's freeform descrição -- same
// OpenAI-compatible chat-completions client shape as apostas-api's own
// internal/ai (which talks to the homelab's 9router for the vision
// extraction), minus the multimodal content array since there is no
// image here, just text in and strict JSON out.
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

const requestTimeout = 30 * time.Second

const (
	envBaseURL = "APOSTAS_RESULTADO_WORKER_AI_BASE_URL"
	envAPIKey  = "APOSTAS_RESULTADO_WORKER_AI_API_KEY"
	envModel   = "APOSTAS_RESULTADO_WORKER_AI_MODEL"
)

// Client is safe for concurrent use. A nil *Client is valid and simply
// disabled -- a cycle with no AI configured just skips every aposta
// (nothing resolves without a way to reason about it).
type Client struct {
	base  string
	key   string
	model string
	hc    *http.Client
}

// New builds a client against a proxy root (e.g.
// http://9router:20128/v1). An empty base URL or model means disabled.
func New(baseURL, apiKey, model string) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	model = strings.TrimSpace(model)
	if base == "" || model == "" {
		return nil
	}
	return &Client{base: base, key: strings.TrimSpace(apiKey), model: model, hc: &http.Client{Timeout: requestTimeout}}
}

// NewFromEnv reads APOSTAS_RESULTADO_WORKER_AI_BASE_URL/_API_KEY/_MODEL.
func NewFromEnv() *Client {
	return New(os.Getenv(envBaseURL), os.Getenv(envAPIKey), os.Getenv(envModel))
}

// Enabled reports whether there is anywhere to send a reasoning request.
func (c *Client) Enabled() bool { return c != nil && c.base != "" }

// Evento is what ExtrairEvento reads out of an aposta's freeform
// descrição. Confianca is "alta"/"media"/"baixa" -- the worker only
// acts past the "alta" step, never on a guess.
type Evento struct {
	Esporte       string  `json:"esporte"`
	ParticipanteA string  `json:"participanteA"`
	ParticipanteB string  `json:"participanteB"`
	Mercado       string  `json:"mercado"`
	Linha         float64 `json:"linha"`
	Confianca     string  `json:"confianca"`
}

// Resultado is what DecidirResultado answers once a real placar is in
// hand -- "green"/"red"/"cancelada", only actioned at confianca "alta".
type Resultado struct {
	Resultado string `json:"resultado"`
	Confianca string `json:"confianca"`
}

// ErrNaoConfigurada is returned when no client is wired up.
var ErrNaoConfigurada = errors.New("IA não configurada neste worker")

// ExtrairEvento reads an aposta's freeform descrição and pulls out the
// event it refers to (sport, participants, market, line) so the caller
// can look up a real placar for it.
func (c *Client) ExtrairEvento(ctx context.Context, descricao string, dataAposta time.Time) (Evento, error) {
	if !c.Enabled() {
		return Evento{}, ErrNaoConfigurada
	}
	prompt := fmt.Sprintf(`Você lê a descrição livre de uma aposta esportiva já feita e identifica o evento
a que ela se refere, para que o resultado real possa ser buscado depois.

Descrição da aposta: %q
Data em que a aposta foi feita: %s

Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, no formato exato:
{"esporte":"futebol","participanteA":"...","participanteB":"...","mercado":"vencedor|over_under|handicap|outro","linha":0,"confianca":"alta|media|baixa"}

- "esporte": o esporte do evento (hoje só "futebol" é usado pelo restante do sistema).
- "participanteA"/"participanteB": os dois times/competidores envolvidos.
- "mercado": "vencedor" (um lado vence ou empate), "over_under" (total de gols/pontos acima ou
  abaixo de uma linha), "handicap", ou "outro" se não reconhecer.
- "linha": o número relevante pro mercado (ex.: 2.5 em "Over 2.5 gols"), 0 se não houver.
- "confianca": "alta" só se você identificou os dois participantes e o mercado com clareza; "baixa"
  se a descrição for vaga demais pra identificar um jogo real.`, descricao, dataAposta.Format("2006-01-02"))

	var evento Evento
	if err := c.chat(ctx, prompt, &evento); err != nil {
		return Evento{}, err
	}
	return evento, nil
}

// DecidirResultado compares the extracted event against a real placar
// and decides green/red/cancelada -- kept as its own call (instead of
// folded into ExtrairEvento) so the model reasons about one thing at a
// time: first "what was bet", then, once real data is in hand, "did it
// hit".
func (c *Client) DecidirResultado(ctx context.Context, evento Evento, placarA, placarB int) (Resultado, error) {
	if !c.Enabled() {
		return Resultado{}, ErrNaoConfigurada
	}
	prompt := fmt.Sprintf(`Um jogo terminou e você precisa decidir se uma aposta feita nele deu green (ganhou),
red (perdeu) ou cancelada (jogo não teve resultado válido pro mercado, ex.: adiado/mercado não
aplicável).

Aposta: participanteA=%q participanteB=%q mercado=%q linha=%v
Placar final: %s %d x %d %s

Responda APENAS com um JSON válido, sem markdown, sem texto antes ou depois, no formato exato:
{"resultado":"green|red|cancelada","confianca":"alta|media|baixa"}

"confianca" só deve ser "alta" se o placar acima é claramente suficiente pra decidir o mercado
apostado sem ambiguidade. Se não tiver certeza, responda com "confianca":"baixa" mesmo que arrisque
um palpite de "resultado".`, evento.ParticipanteA, evento.ParticipanteB, evento.Mercado, evento.Linha,
		evento.ParticipanteA, placarA, placarB, evento.ParticipanteB)

	var resultado Resultado
	if err := c.chat(ctx, prompt, &resultado); err != nil {
		return Resultado{}, err
	}
	return resultado, nil
}

func (c *Client) chat(ctx context.Context, prompt string, out any) error {
	payload, _ := json.Marshal(map[string]any{
		"model":       c.model,
		"temperature": 0.0,
		"max_tokens":  256,
		// 9router streams by default for at least some model/combo
		// routes -- see apostas-api's own internal/ai for the same
		// confirmed-live gotcha. Explicit false is load-bearing.
		"stream":   false,
		"messages": []map[string]any{{"role": "user", "content": prompt}},
	})

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.key != "" {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}

	res, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("não foi possível falar com a IA: %w", err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return errors.New("resposta da IA ilegível")
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("a IA recusou o pedido (HTTP %d)", res.StatusCode)
	}

	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &completion); err != nil || len(completion.Choices) == 0 {
		return errors.New("resposta da IA em formato inesperado")
	}

	content := completion.Choices[0].Message.Content
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		log.Printf("apostas-resultado-worker: internal/ai resposta sem JSON: %q", content)
		return errors.New("a IA não devolveu um JSON")
	}
	if err := json.Unmarshal([]byte(content[start:end+1]), out); err != nil {
		log.Printf("apostas-resultado-worker: internal/ai JSON inválido: %q", content)
		return errors.New("a IA não devolveu um JSON válido")
	}
	return nil
}
