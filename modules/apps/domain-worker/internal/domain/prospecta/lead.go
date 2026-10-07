package prospecta

import (
	"errors"
	"time"
)

// Erros do agregado Lead.
var (
	ErrLeadIDRequired     = errors.New("lead_id is required")
	ErrCompanyNameRequired = errors.New("company_name is required")
	ErrDomainRequired     = errors.New("domain is required")
	ErrFitOutOfRange      = errors.New("fit must be between 0 and 100")
	ErrLeadNotDraft       = errors.New("lead is not in a transitionable status")
)

// LeadStatus é o ciclo de vida do lead (data-model §4). Descoberto → enriquecido
// → qualificado → contactado → respondeu → reunião.
type LeadStatus string

const (
	LeadDiscoveredStatus  LeadStatus = "discovered"
	LeadEnrichedStatus    LeadStatus = "enriched"
	LeadQualifiedStatus   LeadStatus = "qualified"
	LeadContactedStatus   LeadStatus = "contacted"
	LeadRepliedStatus     LeadStatus = "replied"
	LeadMeetingStatus     LeadStatus = "meeting"
)

// Lead é um prospect descoberto dentro de uma campanha. A chave de dedup é
// (tenant_id, domain, company_name): o mesmo prospect achado duas vezes é UM
// lead (§UpsertLead idempotente).
type Lead struct {
	ID          string
	TenantID    string
	CampaignID  string
	CompanyName string
	Domain      string
	Segment     string
	Channel     string
	Fit         int
	Status      LeadStatus
	SourceURL   string
	Enriched    map[string]any
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// NewLead valida a descoberta. O fit começa em 0 (ainda não qualificado). A
// empresa e o domínio são obrigatórios: sem eles a dedup não tem chave.
func NewLead(id, tenantID, campaignID, companyName, domain, segment, channel, sourceURL string) (Lead, error) {
	if tenantID == "" {
		return Lead{}, ErrTenantIDRequired
	}
	if campaignID == "" {
		return Lead{}, ErrCampaignIDRequired
	}
	if companyName == "" {
		return Lead{}, ErrCompanyNameRequired
	}
	if domain == "" {
		return Lead{}, ErrDomainRequired
	}
	return Lead{
		ID:          id,
		TenantID:    tenantID,
		CampaignID:  campaignID,
		CompanyName: companyName,
		Domain:      domain,
		Segment:     segment,
		Channel:     channel,
		Fit:         0,
		Status:      LeadDiscoveredStatus,
		SourceURL:   sourceURL,
	}, nil
}

// ValidateFit é o invariante compartilhado de fit: 0..100, senão 422. Vale para
// a descoberta, a qualificação e o ajuste manual pelo operador.
func ValidateFit(fit int) error {
	if fit < 0 || fit > 100 {
		return ErrFitOutOfRange
	}
	return nil
}

// Qualify marca o lead como qualificado com o fit informado. O fit é validado
// aqui (0..100) — a borda o rejeita com 422 antes de publicar, mas o worker não
// confia na borda.
func (l Lead) Qualify(fit int) (Lead, error) {
	if err := ValidateFit(fit); err != nil {
		return l, err
	}
	next := l
	next.Fit = fit
	next.Status = LeadQualifiedStatus
	return next, nil
}

// Enrich registra os dados do decisor (e-mail corporativo...) e move o lead de
// discovered para enriched, sem tocar o fit.
func (l Lead) Enrich(enriched map[string]any) (Lead, error) {
	if l.Status != LeadDiscoveredStatus && l.Status != LeadEnrichedStatus {
		return l, ErrLeadNotDraft
	}
	next := l
	next.Enriched = enriched
	next.Status = LeadEnrichedStatus
	return next, nil
}

// BookMeeting marca a reunião agendada (o output do produto é pipeline, não
// lista — §1).
func (l Lead) BookMeeting() (Lead, error) {
	next := l
	next.Status = LeadMeetingStatus
	return next, nil
}
