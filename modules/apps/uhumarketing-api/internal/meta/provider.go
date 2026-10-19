// Package meta é o único lugar que fala com o WhatsApp. Existe para que o
// resto do serviço nunca precise saber que há HTTP na frente do canal — e para
// que o modo `dry-run` seja uma implementação do mesmo contrato, não um `if`
// espalhado pelo código.
package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

// Provider é o contrato mínimo do WhatsApp Business Platform.
type Provider interface {
	// Name aparece no /healthz e na tela de configuração.
	Name() string
	// CreateTemplate submete o template e devolve o id externo + status inicial.
	CreateTemplate(ctx context.Context, t domain.Template) (externalID, status string, err error)
	// SendTemplate entrega uma mensagem de template e devolve o id externo.
	SendTemplate(ctx context.Context, req SendRequest) (messageID string, err error)
}

// SendRequest é a mensagem já resolvida: o provedor não escolhe audiência nem
// aplica opt-in, só entrega o que o worker mandou.
type SendRequest struct {
	To           string
	TemplateName string
	Language     string
	Category     string
	// Params são os valores das variáveis do corpo, na ordem dos índices.
	Params []string
	// HeaderImageURL só é usado quando o template tem cabeçalho de mídia.
	HeaderImageURL string
}

/* ---------------------------------------------------------------- dry-run */

// DryRunProvider é o provedor de desenvolvimento. Não toca a rede: gera ids
// determinísticos, aprova templates na hora e "entrega" mensagens. Serve para
// exercitar o produto inteiro — fila, webhook, métricas — sem conta na Meta, e
// é o que roda nos testes.
type DryRunProvider struct {
	// FailWith, quando preenchido, faz SendTemplate falhar com essa mensagem.
	// Existe para testar o caminho de erro sem mock de interface.
	FailWith string
	seq      atomic.Int64
}

func (*DryRunProvider) Name() string { return "dry-run" }

func (*DryRunProvider) CreateTemplate(_ context.Context, t domain.Template) (string, string, error) {
	// Aprova na hora: em desenvolvimento, esperar um webhook que nunca vem
	// deixaria o fluxo travado em "pendente" para sempre.
	return "dry_" + t.ID, "approved", nil
}

func (p *DryRunProvider) SendTemplate(_ context.Context, req SendRequest) (string, error) {
	if p.FailWith != "" {
		return "", fmt.Errorf("%s", p.FailWith)
	}
	if req.To == "" {
		return "", fmt.Errorf("destinatário vazio")
	}
	n := p.seq.Add(1)
	return fmt.Sprintf("wamid.dry.%d.%s", n, req.To), nil
}

/* ------------------------------------------------------------------- live */

// CloudProvider é a Cloud API da Meta (graph.facebook.com). O token nunca é
// logado; erros carregam só o código e a mensagem devolvidos pela Graph.
type CloudProvider struct {
	BaseURL       string
	APIVersion    string
	WABAID        string
	PhoneNumberID string
	Token         string
	HTTP          *http.Client
}

func (p *CloudProvider) Name() string { return "meta-cloud" }

func (p *CloudProvider) client() *http.Client {
	if p.HTTP != nil {
		return p.HTTP
	}
	return &http.Client{Timeout: 20 * time.Second}
}

type graphErrDetail struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    int    `json:"code"`
	Subcode int    `json:"error_subcode"`
}

type graphError struct {
	Detail graphErrDetail `json:"error"`
}

func (e graphError) Error() string {
	return fmt.Sprintf("meta: %s (code %d/%d)", e.Detail.Message, e.Detail.Code, e.Detail.Subcode)
}

func (p *CloudProvider) post(ctx context.Context, path string, body any) ([]byte, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/%s/%s", strings.TrimRight(p.BaseURL, "/"), p.APIVersion, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		var ge graphError
		if json.Unmarshal(payload, &ge) == nil && ge.Detail.Message != "" {
			return nil, ge
		}
		return nil, fmt.Errorf("meta: http %d: %s", resp.StatusCode, truncate(string(payload), 200))
	}
	return payload, nil
}

func (p *CloudProvider) CreateTemplate(ctx context.Context, t domain.Template) (string, string, error) {
	components := []map[string]any{}

	if t.Header.Kind != "" && t.Header.Kind != "none" {
		header := map[string]any{"type": "HEADER"}
		if t.Header.Kind == "text" {
			header["format"] = "TEXT"
			header["text"] = t.Header.Text
			header["example"] = map[string][]string{"header_text": {firstNonEmpty(t.Header.Text, "Café Aurora")}}
		} else {
			header["format"] = strings.ToUpper(t.Header.Kind)
			// A Meta exige um handle de exemplo na submissão; a mídia real vai
			// por link no disparo.
			header["example"] = map[string][]string{"header_handle": {"https://cafeaurora.com.br/exemplo.jpg"}}
		}
		components = append(components, header)
	}

	body := map[string]any{"type": "BODY", "text": t.Body}
	if len(t.Variables) > 0 {
		examples := make([]string, 0, len(t.Variables))
		for _, v := range t.Variables {
			examples = append(examples, firstNonEmpty(v.Example, "exemplo"))
		}
		body["example"] = map[string][][]string{"body_text": {examples}}
	}
	components = append(components, body)

	if len(t.Buttons) > 0 {
		buttons := make([]map[string]any, 0, len(t.Buttons))
		for _, b := range t.Buttons {
			btn := map[string]any{"type": strings.ToUpper(b.Type), "text": b.Text}
			switch b.Type {
			case "url":
				btn["url"] = b.Value
			case "phone":
				btn["phone_number"] = b.Value
			}
			buttons = append(buttons, btn)
		}
		components = append(components, map[string]any{"type": "BUTTONS", "buttons": buttons})
	}

	payload := map[string]any{
		"name":       t.Name,
		"language":   t.Language,
		"category":   strings.ToUpper(t.Category),
		"components": components,
	}

	raw, err := p.post(ctx, p.WABAID+"/message_templates", payload)
	if err != nil {
		return "", "", err
	}
	var out struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", "", fmt.Errorf("meta: resposta inesperada: %w", err)
	}
	status := "pending"
	switch strings.ToUpper(out.Status) {
	case "APPROVED":
		status = "approved"
	case "REJECTED":
		status = "rejected"
	case "PAUSED":
		status = "paused"
	}
	return out.ID, status, nil
}

func (p *CloudProvider) SendTemplate(ctx context.Context, req SendRequest) (string, error) {
	components := make([]map[string]any, 0, 2)
	if req.HeaderImageURL != "" {
		components = append(components, map[string]any{
			"type":       "header",
			"parameters": []map[string]any{{"type": "image", "image": map[string]string{"link": req.HeaderImageURL}}},
		})
	}
	if len(req.Params) > 0 {
		params := make([]map[string]string, 0, len(req.Params))
		for _, v := range req.Params {
			params = append(params, map[string]string{"type": "text", "text": v})
		}
		components = append(components, map[string]any{"type": "body", "parameters": params})
	}

	payload := map[string]any{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                req.To,
		"type":              "template",
		"template": map[string]any{
			"name":       req.TemplateName,
			"language":   map[string]string{"code": req.Language},
			"components": components,
		},
	}

	raw, err := p.post(ctx, p.PhoneNumberID+"/messages", payload)
	if err != nil {
		return "", err
	}
	var out struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("meta: resposta inesperada: %w", err)
	}
	if len(out.Messages) == 0 {
		return "", fmt.Errorf("meta: nenhuma mensagem devolvida")
	}
	return out.Messages[0].ID, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

/* ------------------------------------------------------------------ preço */

// CostPerMessage devolve o preço de tabela por mensagem entregue, em reais, por
// categoria. É uma referência de POC: o valor real depende do país do
// destinatário e do contrato com a Meta/BSP, e vive na tabela de preço do
// provedor — mas o produto precisa de *algum* número para a conta de custo não
// mentir por omissão.
func CostPerMessage(category string) float64 {
	switch category {
	case "marketing":
		return 0.0625
	case "utility":
		return 0.0080
	case "authentication":
		return 0.0315
	}
	return 0.0625
}

// Resolve escolhe o provedor a partir da configuração. Modo `live` incompleto é
// erro de boot, não degradação silenciosa para dry-run: um token faltando não
// pode virar "mensagens que nunca saem" sem ninguém perceber.
func Resolve(mode, baseURL, apiVersion, wabaID, phoneNumberID, token string) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", "dry-run", "dryrun", "dry":
		return &DryRunProvider{}, nil
	case "live", "meta":
		if wabaID == "" || phoneNumberID == "" || token == "" {
			return nil, fmt.Errorf("META_MODE=live exige META_WABA_ID, META_PHONE_NUMBER_ID e META_TOKEN")
		}
		if apiVersion == "" {
			apiVersion = "v21.0"
		}
		if baseURL == "" {
			baseURL = "https://graph.facebook.com"
		}
		return &CloudProvider{
			BaseURL:       baseURL,
			APIVersion:    apiVersion,
			WABAID:        wabaID,
			PhoneNumberID: phoneNumberID,
			Token:         token,
		}, nil
	default:
		return nil, fmt.Errorf("META_MODE inválido: %q (use dry-run ou live)", mode)
	}
}
