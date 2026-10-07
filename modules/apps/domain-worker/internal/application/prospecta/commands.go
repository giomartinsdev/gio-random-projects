// Package prospecta holds the concrete application.Command payloads for the
// Prospecta Company/ICP aggregate — a prospecta-api (ACL) builds the same
// shapes on the other end (its own copy, usada só para produzir comandos).
// Os nomes dos campos precisam casar byte a byte com o produtor: um rename de
// um lado só vira campo zero em silêncio (json.Unmarshal ignora chave
// desconhecida) -- o mesmo risco que main_test.go trava para clubs/finance.
package prospecta

// CreateCompanyInput é o payload do comando "CreateCompany".
type CreateCompanyInput struct {
	TenantID    string `json:"tenant_id"`
	Name        string `json:"name"`
	Site        string `json:"site,omitempty"`
	Description string `json:"description,omitempty"`
}

// DefineICPInput é o payload do comando "DefineICP". company_id é o uuid
// gerado por quem aplicou o CreateCompany.
type DefineICPInput struct {
	TenantID   string   `json:"tenant_id"`
	CompanyID  string   `json:"company_id"`
	Definition string   `json:"definition"`
	Signals    []string `json:"signals,omitempty"`
}

// CreateCampaignInput é o payload do comando "CreateCampaign". icp_id não é
// obrigatório na criação (a campanha nasce draft); StartCampaign o exige.
type CreateCampaignInput struct {
	TenantID       string   `json:"tenant_id"`
	CompanyID      string   `json:"company_id"`
	ICPID          string   `json:"icp_id,omitempty"`
	Name           string   `json:"name"`
	Channels       []string `json:"channels,omitempty"`
	ApprovalPolicy string   `json:"approval_policy,omitempty"`
}

// StartCampaignInput é o payload do comando "StartCampaign".
type StartCampaignInput struct {
	TenantID   string `json:"tenant_id"`
	CampaignID string `json:"campaign_id"`
}

// RequestProspectInput é o payload do comando "RequestProspect": abre um run do
// prospector para a campanha.
type RequestProspectInput struct {
	TenantID   string `json:"tenant_id"`
	CampaignID string `json:"campaign_id"`
}

// UpsertLeadInput é o payload do comando "UpsertLead". fit é opcional na
// descoberta; quando presente precisa estar em 0..100.
type UpsertLeadInput struct {
	TenantID    string         `json:"tenant_id"`
	CampaignID  string         `json:"campaign_id"`
	CompanyName string         `json:"company_name"`
	Domain      string         `json:"domain"`
	Segment     string         `json:"segment,omitempty"`
	Channel     string         `json:"channel,omitempty"`
	Fit         int            `json:"fit,omitempty"`
	SourceURL   string         `json:"source_url,omitempty"`
	Enriched    map[string]any `json:"enriched,omitempty"`
}

// QualifyLeadInput é o payload do comando "QualifyLead" (ajuste de fit,
// inclusive manual pelo operador).
type QualifyLeadInput struct {
	TenantID string `json:"tenant_id"`
	LeadID   string `json:"lead_id"`
	Fit      int    `json:"fit"`
}

// DraftMessageInput é o payload do comando "DraftMessage".
type DraftMessageInput struct {
	TenantID string `json:"tenant_id"`
	LeadID   string `json:"lead_id"`
	Channel  string `json:"channel"`
	Content  string `json:"content"`
}

// ApproveMessageInput é o payload do comando "ApproveMessage".
type ApproveMessageInput struct {
	TenantID  string `json:"tenant_id"`
	MessageID string `json:"message_id"`
}

// SendMessageInput é o payload do comando "SendMessage".
type SendMessageInput struct {
	TenantID   string `json:"tenant_id"`
	MessageID  string `json:"message_id"`
	ExternalID string `json:"external_id"`
}

// ReceiveReplyInput é o payload do comando "ReceiveReply". thread_key é a chave
// de idempotência; lead_id identifica o lead da thread.
type ReceiveReplyInput struct {
	TenantID   string `json:"tenant_id"`
	ThreadKey  string `json:"thread_key"`
	LeadID     string `json:"lead_id"`
	Channel    string `json:"channel,omitempty"`
	Content    string `json:"content"`
	ExternalID string `json:"external_id,omitempty"`
}

// BookMeetingInput é o payload do comando "BookMeeting".
type BookMeetingInput struct {
	TenantID string `json:"tenant_id"`
	LeadID   string `json:"lead_id"`
	When     string `json:"when"`
}

// CreateUserInput é o payload do comando "CreateUser": a conta de autenticação
// e-mail+senha. password_hash já chega pronto (bcrypt) — o worker grava o hash,
// nunca a senha em claro. Vazio para uma conta criada por Google SSO (sem
// senha; o dono a define depois).
type CreateUserInput struct {
	TenantID     string `json:"tenant_id"`
	CompanyID    string `json:"company_id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	PasswordHash string `json:"password_hash"`
	Role         string `json:"role"`
}

// UpdateUserPasswordInput é o payload do comando "UpdateUserPassword": a
// troca/definição do hash da senha de uma conta existente. password_hash já
// chega pronto (bcrypt). idempotente por command_id no repositório.
type UpdateUserPasswordInput struct {
	TenantID     string `json:"tenant_id"`
	UserID       string `json:"user_id"`
	PasswordHash string `json:"password_hash"`
}
