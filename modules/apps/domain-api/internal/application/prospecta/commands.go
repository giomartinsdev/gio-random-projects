// Package prospecta holds domain-api's copies of the Prospecta command
// payloads — the shapes domain-worker decodes on the other end. domain-api
// only ever BUILDS these, never applies them, so there is no Service/Handler
// here. Os campos precisam casar byte a byte com
// domain-worker/internal/application/prospecta/commands.go.
package prospecta

// CreateCompanyInput é o payload do comando "CreateCompany".
type CreateCompanyInput struct {
	TenantID    string `json:"tenant_id"`
	Name        string `json:"name"`
	Site        string `json:"site,omitempty"`
	Description string `json:"description,omitempty"`
}

// DefineICPInput é o payload do comando "DefineICP".
type DefineICPInput struct {
	TenantID   string   `json:"tenant_id"`
	CompanyID  string   `json:"company_id"`
	Definition string   `json:"definition"`
	Signals    []string `json:"signals,omitempty"`
}

// CreateCampaignInput é o payload do comando "CreateCampaign".
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

// RequestProspectInput é o payload do comando "RequestProspect".
type RequestProspectInput struct {
	TenantID   string `json:"tenant_id"`
	CampaignID string `json:"campaign_id"`
}

// UpsertLeadInput é o payload do comando "UpsertLead".
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

// QualifyLeadInput é o payload do comando "QualifyLead".
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

// ReceiveReplyInput é o payload do comando "ReceiveReply".
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
