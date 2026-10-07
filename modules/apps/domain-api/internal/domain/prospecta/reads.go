// Package prospecta holds domain-api's read models for the Prospecta context.
// As leituras são projeções puras sobre as tabelas que o domain-worker escreve
// (prospecta_company/prospecta_icp/campaign/lead/message/conversation/agent_run);
// domain-api é read-only aqui, como em todo o resto do repo.
package prospecta

import (
	"context"
	"errors"
)

// ErrNotFound é devolvido quando a projeção não existe no tenant.
var ErrNotFound = errors.New("prospecta projection not found")

// CompanyView é a empresa como a API devolve.
type CompanyView struct {
	ID          string   `json:"id"`
	TenantID    string   `json:"tenant_id"`
	Name        string   `json:"name"`
	Site        string   `json:"site"`
	Description string   `json:"description"`
	CreatedAt   string   `json:"created_at"`
	ICP         *ICPView `json:"icp,omitempty"`
}

// ICPView é o ICP projetado.
type ICPView struct {
	ID         string   `json:"id"`
	CompanyID  string   `json:"company_id"`
	Definition string   `json:"definition"`
	Signals    []string `json:"signals"`
	CreatedAt  string   `json:"created_at"`
}

// Page é uma projeção paginada por cursor: os itens de uma página mais o cursor
// da próxima (nil quando não há). O par de domínio é dono da ordenação; o shape
// espelha domain.Page da prospecta-api, que apenas reemite.
type Page[T any] struct {
	Items []T     `json:"items"`
	Next  *string `json:"next"`
}

// CampaignView é a campanha como a API devolve. LeadsCount é derivado (contagem
// em prospecta_lead), não uma coluna.
type CampaignView struct {
	ID         string   `json:"id"`
	CompanyID  string   `json:"company_id"`
	ICPID      string   `json:"icp_id,omitempty"`
	Name       string   `json:"name"`
	Status     string   `json:"status"`
	Channels   []string `json:"channels"`
	LeadsCount int      `json:"leads_count"`
}

// LeadView é o lead. A lista lê os campos achatados; o detalhe carrega o
// enriquecimento, a timeline e a última mensagem. Os extras são omitempty para
// a projeção de lista continuar enxuta — o shape exato de domain.Lead da
// prospecta-api.
type LeadView struct {
	ID          string          `json:"id"`
	CampaignID  string          `json:"campaign_id,omitempty"`
	CompanyName string          `json:"company_name"`
	Segment     string          `json:"segment,omitempty"`
	Channel     string          `json:"channel,omitempty"`
	Fit         int             `json:"fit"`
	Status      string          `json:"status"`
	SourceURL   string          `json:"source_url,omitempty"`
	Enriched    map[string]any  `json:"enriched,omitempty"`
	Timeline    []TimelineEntry `json:"timeline,omitempty"`
	LastMessage *MessageView    `json:"last_message,omitempty"`
}

// TimelineEntry é um passo da história de um lead. Derivada do próprio estado
// do lead (não há tabela de histórico dedicada no MVP): discovered no created_at
// e o estado atual no updated_at quando ele avançou.
type TimelineEntry struct {
	At     string `json:"at"`
	Kind   string `json:"kind"`
	Detail string `json:"detail,omitempty"`
}

// ConversationView é a thread de um lead: os resumos do inbox na lista e as
// mensagens ordenadas no detalhe. CompanyName/Channel são derivados do lead.
type ConversationView struct {
	ID          string        `json:"id"`
	LeadID      string        `json:"lead_id"`
	CompanyName string        `json:"company_name,omitempty"`
	Channel     string        `json:"channel,omitempty"`
	LastMessage string        `json:"last_message,omitempty"`
	Unread      int           `json:"unread"`
	State       string        `json:"state"`
	Messages    []MessageView `json:"messages,omitempty"`
}

// MessageView é a projeção de prospecta_message. Status dirige o invariante do
// approve: só uma mensagem em "drafted" pode ser aprovada.
type MessageView struct {
	ID        string `json:"id"`
	LeadID    string `json:"lead_id,omitempty"`
	Channel   string `json:"channel,omitempty"`
	Direction string `json:"direction,omitempty"`
	Content   string `json:"content,omitempty"`
	Status    string `json:"status,omitempty"`
	SentAt    string `json:"sent_at,omitempty"`
}

// LeadFilter é o querystring de GET /leads. Valores zero significam "sem filtro".
type LeadFilter struct {
	CampaignID string
	Status     string
	FitMin     int
}

// AgentRunEvent é uma amostra de agent_run transmitida ao vivo no feed SSE. O
// shape espelha domain.AgentRunEvent da prospecta-api e o payload do contrato:
//
//	event: agent
//	data: {"run_id":"...","agent":"prospector","state":"running","metric":{...}}
type AgentRunEvent struct {
	RunID  string         `json:"run_id"`
	Agent  string         `json:"agent"`
	State  string         `json:"state"`
	Metric map[string]any `json:"metric,omitempty"`
}

// ReadRepository é a porta de leitura (só leitura: o domain-worker escreve).
// Toda leitura é por tenant e as listas paginam por cursor (id).
type ReadRepository interface {
	GetCompany(ctx context.Context, tenantID, id string) (CompanyView, error)
	ICPByCompany(ctx context.Context, tenantID, companyID string) (ICPView, error)

	ListCampaigns(ctx context.Context, tenantID string, limit int, cursor string) (Page[CampaignView], error)
	GetCampaign(ctx context.Context, tenantID, id string) (CampaignView, error)

	ListLeads(ctx context.Context, tenantID string, f LeadFilter, limit int, cursor string) (Page[LeadView], error)
	GetLead(ctx context.Context, tenantID, id string) (LeadView, error)

	ListConversations(ctx context.Context, tenantID string, limit int, cursor string) (Page[ConversationView], error)
	GetConversation(ctx context.Context, tenantID, id string) (ConversationView, error)
	GetMessage(ctx context.Context, tenantID, id string) (MessageView, error)

	// ListActivity devolve os runs mais recentes do tenant (mais novo primeiro),
	// que o handler SSE emite e deduplica enquanto o cliente fica conectado.
	ListActivity(ctx context.Context, tenantID string, limit int) ([]AgentRunEvent, error)
}

// CursorFrom devolve o *string de "next" (nil quando vazio), para o JSON bater
// com o Page da prospecta-api (next: null).
func CursorFrom(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}
