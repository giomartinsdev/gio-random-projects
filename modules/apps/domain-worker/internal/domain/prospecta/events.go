package prospecta

import "time"

// Event é implementado por todo evento de domínio deste agregado.
type Event interface {
	EventName() string
}

// CompanyRegistered diz que uma empresa entrou no Prospecta. Nome e site vão
// junto para o worker agêntico renderizar o contexto sem um GET de volta.
//
// O NOME do evento é o do contrato (specs/004-prospecta §7.1 /
// contracts/domain-api-extensions.md): "CompanyRegistered", PascalCase. É a
// única família do worker nesse formato -- as demais são dotted.minúsculo
// ("finance.transaction.registered"); o consumidor (prospecta-agent-worker) é
// construído a partir do contrato, então a string do contrato manda aqui.
type CompanyRegistered struct {
	CompanyID  string    `json:"company_id"`
	TenantID   string    `json:"tenant_id"`
	Name       string    `json:"name"`
	Site       string    `json:"site"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (CompanyRegistered) EventName() string { return "CompanyRegistered" }

// ICPDefined diz que o ICP de uma empresa foi definido.
type ICPDefined struct {
	ICPID      string    `json:"icp_id"`
	CompanyID  string    `json:"company_id"`
	TenantID   string    `json:"tenant_id"`
	Definition string    `json:"definition"`
	Signals    []string  `json:"signals"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (ICPDefined) EventName() string { return "ICPDefined" }

// CampaignStarted diz que a campanha saiu de draft e os agentes podem rodar.
type CampaignStarted struct {
	CampaignID string    `json:"campaign_id"`
	CompanyID  string    `json:"company_id"`
	ICPID      string    `json:"icp_id"`
	TenantID   string    `json:"tenant_id"`
	Name       string    `json:"name"`
	Channels   []string  `json:"channels"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (CampaignStarted) EventName() string { return "CampaignStarted" }

// ProspectRequested diz que um run de prospecção foi aberto para a campanha — é
// o gatilho que o prospecta-agent-worker consome.
type ProspectRequested struct {
	RunID      string        `json:"run_id"`
	CampaignID string        `json:"campaign_id"`
	CompanyID  string        `json:"company_id"`
	ICPID      string        `json:"icp_id"`
	TenantID   string        `json:"tenant_id"`
	Agent      AgentRunAgent `json:"agent"`
	OccurredAt time.Time     `json:"occurred_at"`
}

func (ProspectRequested) EventName() string { return "ProspectRequested" }

// LeadDiscovered diz que um prospect entrou no pipeline. Levantado pelo
// UpsertLead (o worker de domínio) — o agente publica o mesmo nome, e o
// domínio o aplica idempotentemente por (domain, company_name).
type LeadDiscovered struct {
	LeadID      string     `json:"lead_id"`
	CampaignID  string     `json:"campaign_id"`
	CompanyID   string     `json:"company_id"`
	TenantID    string     `json:"tenant_id"`
	CompanyName string     `json:"company_name"`
	Domain      string     `json:"domain"`
	Segment     string     `json:"segment"`
	Channel     string     `json:"channel"`
	SourceURL   string     `json:"source_url"`
	Status      LeadStatus `json:"status"`
	OccurredAt  time.Time  `json:"occurred_at"`
}

func (LeadDiscovered) EventName() string { return "LeadDiscovered" }

// LeadEnriched diz que o decisor/e-mail corporativo do lead foi resolvido.
type LeadEnriched struct {
	LeadID     string         `json:"lead_id"`
	CampaignID string         `json:"campaign_id"`
	TenantID   string         `json:"tenant_id"`
	Enriched   map[string]any `json:"enriched"`
	Status     LeadStatus     `json:"status"`
	OccurredAt time.Time      `json:"occurred_at"`
}

func (LeadEnriched) EventName() string { return "LeadEnriched" }

// LeadQualified diz que o lead recebeu um fit (0..100) e entrou no pipeline de
// abordagem.
type LeadQualified struct {
	LeadID      string     `json:"lead_id"`
	CampaignID  string     `json:"campaign_id"`
	CompanyID   string     `json:"company_id"`
	TenantID    string     `json:"tenant_id"`
	CompanyName string     `json:"company_name"`
	Fit         int        `json:"fit"`
	Status      LeadStatus `json:"status"`
	OccurredAt  time.Time  `json:"occurred_at"`
}

func (LeadQualified) EventName() string { return "LeadQualified" }

// MessageDrafted diz que uma abordagem foi redigida e aguarda aprovação (D10).
type MessageDrafted struct {
	MessageID  string           `json:"message_id"`
	LeadID     string           `json:"lead_id"`
	TenantID   string           `json:"tenant_id"`
	Channel    string           `json:"channel"`
	Direction  MessageDirection `json:"direction"`
	Status     MessageStatus    `json:"status"`
	OccurredAt time.Time        `json:"occurred_at"`
}

func (MessageDrafted) EventName() string { return "MessageDrafted" }

// MessageApproved diz que o humano aprovou a abordagem; é o sinal para o worker
// agêntico enviar.
type MessageApproved struct {
	MessageID  string        `json:"message_id"`
	LeadID     string        `json:"lead_id"`
	TenantID   string        `json:"tenant_id"`
	Channel    string        `json:"channel"`
	Status     MessageStatus `json:"status"`
	OccurredAt time.Time     `json:"occurred_at"`
}

func (MessageApproved) EventName() string { return "MessageApproved" }

// MessageSent diz que a abordagem saiu pelo provedor (Evolution/e-mail), com o
// id externo que a reconciliação usa.
type MessageSent struct {
	MessageID  string        `json:"message_id"`
	LeadID     string        `json:"lead_id"`
	TenantID   string        `json:"tenant_id"`
	Channel    string        `json:"channel"`
	ExternalID string        `json:"external_id"`
	Status     MessageStatus `json:"status"`
	OccurredAt time.Time     `json:"occurred_at"`
}

func (MessageSent) EventName() string { return "MessageSent" }

// ReplyReceived diz que o lead respondeu em uma thread.
type ReplyReceived struct {
	ConversationID string        `json:"conversation_id"`
	MessageID      string        `json:"message_id"`
	LeadID         string        `json:"lead_id"`
	TenantID       string        `json:"tenant_id"`
	ThreadKey      string        `json:"thread_key"`
	Channel        string        `json:"channel"`
	Status         MessageStatus `json:"status"`
	OccurredAt     time.Time     `json:"occurred_at"`
}

func (ReplyReceived) EventName() string { return "ReplyReceived" }

// MeetingBooked diz que o lead virou reunião agendada — o output do produto.
type MeetingBooked struct {
	LeadID      string     `json:"lead_id"`
	CampaignID  string     `json:"campaign_id"`
	TenantID    string     `json:"tenant_id"`
	CompanyName string     `json:"company_name"`
	When        string     `json:"when"`
	Status      LeadStatus `json:"status"`
	OccurredAt  time.Time  `json:"occurred_at"`
}

func (MeetingBooked) EventName() string { return "MeetingBooked" }

// UserRegistered diz que uma conta (e-mail+senha) entrou no Prospecta. Só os
// ids e o e-mail vão no evento — nunca o password_hash: o evento trafega no
// broker, e o hash não tem por que sair do banco. O e-mail é o identificador do
// login (único global).
type UserRegistered struct {
	UserID     string    `json:"user_id"`
	TenantID   string    `json:"tenant_id"`
	CompanyID  string    `json:"company_id"`
	Email      string    `json:"email"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (UserRegistered) EventName() string { return "UserRegistered" }

// UserPasswordChanged diz que a senha de uma conta foi trocada (ou definida
// pela primeira vez, no caso de uma conta só-Google). NÃO leva o hash: o
// segredo não trafega no broker.
type UserPasswordChanged struct {
	UserID     string    `json:"user_id"`
	TenantID   string    `json:"tenant_id"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (UserPasswordChanged) EventName() string { return "UserPasswordChanged" }

// AgentRunUpdated diz que um run mudou de estado (running → done/failed), com as
// métricas do run. Opcional no contrato: quem lê o feed do Cockpit o consome.
type AgentRunUpdated struct {
	RunID      string         `json:"run_id"`
	CampaignID string         `json:"campaign_id"`
	TenantID   string         `json:"tenant_id"`
	Agent      AgentRunAgent  `json:"agent"`
	State      AgentRunState  `json:"state"`
	Metrics    map[string]any `json:"metrics,omitempty"`
	OccurredAt time.Time      `json:"occurred_at"`
}

func (AgentRunUpdated) EventName() string { return "AgentRunUpdated" }

// OptOutSet diz que um lead pediu para não ser contatado. Opcional no contrato:
// propaga o guardrail LGPD para quem assina os eventos do domínio.
type OptOutSet struct {
	LeadID     string    `json:"lead_id"`
	TenantID   string    `json:"tenant_id"`
	Reason     string    `json:"reason"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (OptOutSet) EventName() string { return "OptOutSet" }
