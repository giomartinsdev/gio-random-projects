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
	// Check responde "o canal está de pé?". No dry-run a resposta honesta é
	// "não é live" — não um "conectado" que promete entrega.
	Check(ctx context.Context) (ChannelInfo, error)
	// TemplateStatus consulta o status real de um template já submetido.
	TemplateStatus(ctx context.Context, externalID string) (status, reason string, err error)
}

// ChannelInfo é a resposta crua de uma verificação de canal.
type ChannelInfo struct {
	// Live é false no dry-run: nada sai para a Meta, e a tela não pode
	// mostrar "conectado" como se saísse.
	Live bool `json:"live"`
	// OK é o resultado da verificação. Um token inválido devolve ok=false com
	// o motivo em Note — é diagnóstico, não erro de formulário.
	OK           bool   `json:"ok"`
	Number       string `json:"number,omitempty"`
	VerifiedName string `json:"verifiedName,omitempty"`
	Quality      string `json:"quality,omitempty"`
	Note         string `json:"note"`
}

// ErrNotLive explica por que uma consulta ao provedor não vale no dry-run.
// Vira 422 com texto, não 500: não é falha do servidor, é o modo escolhido.
var ErrNotLive = fmt.Errorf("modo dry-run: o template é aprovado localmente e nada é consultado na Meta")

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

// Check responde a verdade do dry-run: nada sai da máquina. Um "tudo certo"
// aqui faria a tela de configuração prometer entrega que não existe.
func (*DryRunProvider) Check(context.Context) (ChannelInfo, error) {
	return ChannelInfo{
		Live: false,
		Note: "dry-run: as mensagens são simuladas e não chegam a nenhum WhatsApp",
	}, nil
}

func (*DryRunProvider) TemplateStatus(context.Context, string) (string, string, error) {
	return "", "", ErrNotLive
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

// IsBanned reconhece o bloqueio da conta. A Meta devolve os mesmos códigos para
// "conta restrita" e "número restrito"; o operador precisa da orientação (abrir
// recurso no Account Quality), não do número do erro.
func (e graphError) IsBanned() bool {
	switch e.Detail.Code {
	case 131031, // account locked / restricted
		131042, // business eligibility payment issue
		368,    // temporarily blocked for policy violation
		131047: // messaging limit / account restriction
		return true
	}
	return strings.Contains(strings.ToLower(e.Detail.Message), "restricted") ||
		strings.Contains(strings.ToLower(e.Detail.Message), "banned") ||
		strings.Contains(strings.ToLower(e.Detail.Message), "enforcement")
}

// Explain traduz o erro da Graph para o que o operador precisa FAZER. Um código
// numérico na tela não resolve nada; a ação resolve. A mensagem original vai
// entre parênteses para não perder o diagnóstico quando for preciso escalar.
func (e graphError) Explain() string {
	if e.IsBanned() {
		return "a conta do WhatsApp (WABA) está restrita ou banida pela Meta. " +
			"Abra um recurso na página Account Quality do Meta Business Suite; " +
			"enquanto a restrição existir, nenhum envio é possível, mesmo com token válido"
	}
	raw := " (Meta: " + e.Detail.Message + ")"
	switch e.Detail.Code {
	case 190:
		return "token inválido ou expirado: gere outro em API Setup (ou um permanente com System User)" + raw
	case 100:
		return "a Meta recusou os parâmetros: confira Phone Number ID e o nome/categoria do template" + raw
	case 131026:
		return "o destinatário não pode receber mensagem: número sem WhatsApp ou fora da lista de permitidos do número de teste" + raw
	case 132000, 132001, 132005, 132007, 132012, 132015:
		return "o template foi recusado pela Meta: confira conteúdo, variáveis e categoria" + raw
	}
	return "a Meta recusou: " + e.Detail.Message
}

func (p *CloudProvider) post(ctx context.Context, path string, body any) ([]byte, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return p.do(ctx, http.MethodPost, path, bytes.NewReader(raw))
}

func (p *CloudProvider) get(ctx context.Context, path string) ([]byte, error) {
	return p.do(ctx, http.MethodGet, path, nil)
}

// do é o único ponto que monta URL e cabeçalho. GET e POST compartilham a
// leitura de erro porque a Graph devolve o mesmo envelope nos dois — e é esse
// envelope que a tela precisa mostrar em vez de "erro interno".
func (p *CloudProvider) do(ctx context.Context, method, path string, body io.Reader) ([]byte, error) {
	url := fmt.Sprintf("%s/%s/%s", strings.TrimRight(p.BaseURL, "/"), p.APIVersion, path)
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

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
			// Devolve o erro já explicado: quem chama (worker, handler, tela)
			// não deve decidir o que "code 131031" significa.
			return nil, fmt.Errorf("%s", ge.Explain())
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

// Check consulta o número na Graph. Devolve o que a Meta responde — nome
// verificado e número de exibição — porque a tela precisa mostrar o número
// real, não o que foi digitado em Configurações.
func (p *CloudProvider) Check(ctx context.Context) (ChannelInfo, error) {
	raw, err := p.get(ctx, p.PhoneNumberID+"?fields=display_phone_number,verified_name,quality_rating")
	if err != nil {
		return ChannelInfo{}, err
	}
	var out struct {
		DisplayPhoneNumber string `json:"display_phone_number"`
		VerifiedName       string `json:"verified_name"`
		QualityRating      string `json:"quality_rating"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return ChannelInfo{}, fmt.Errorf("meta: resposta inesperada: %w", err)
	}
	note := "conectado à Cloud API"
	if out.QualityRating != "" {
		note += " · qualidade " + strings.ToLower(out.QualityRating)
	}
	return ChannelInfo{
		Live:         true,
		Number:       out.DisplayPhoneNumber,
		VerifiedName: out.VerifiedName,
		Quality:      strings.ToUpper(out.QualityRating),
		Note:         note,
	}, nil
}

// TemplateStatus pergunta à Meta o status de um template já submetido. Existe
// porque sem webhook público o template ficaria "em análise" para sempre no
// banco local — e a tela ficaria bloqueada esperando um callback que não vem.
func (p *CloudProvider) TemplateStatus(ctx context.Context, externalID string) (string, string, error) {
	if externalID == "" {
		return "", "", fmt.Errorf("template sem id externo: submeta à Meta antes de consultar")
	}
	raw, err := p.get(ctx, externalID+"?fields=status,rejected_reason")
	if err != nil {
		return "", "", err
	}
	var out struct {
		Status         string `json:"status"`
		RejectedReason string `json:"rejected_reason"`
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
	reason := out.RejectedReason
	if strings.EqualFold(reason, "NONE") {
		reason = ""
	}
	return status, reason, nil
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
// Resolve devolve o provedor de FALLBACK do processo.
//
// Em live não há canal global: cada conta ativa o próprio WhatsApp, e o token
// dela vem do banco (ver internal/channel). O fallback em live é apenas um
// marcador para o health — quem envia é o canal da conta.
func Resolve(mode, baseURL, apiVersion string) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "", "dry-run", "dryrun", "dry":
		return &DryRunProvider{}, nil
	case "live", "meta":
		if apiVersion == "" {
			apiVersion = "v21.0"
		}
		if baseURL == "" {
			baseURL = "https://graph.facebook.com"
		}
		return &CloudProvider{APIVersion: apiVersion, BaseURL: baseURL}, nil
	default:
		return nil, fmt.Errorf("META_MODE inválido: %q (use dry-run ou live)", mode)
	}
}
