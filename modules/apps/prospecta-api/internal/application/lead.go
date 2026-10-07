package application

import (
	"context"
	"errors"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// QualifyLeadInput is the POST /leads/{id}/qualify body. fit is a manual
// override by the operator and must be within 0..100.
type QualifyLeadInput struct {
	Fit *int `json:"fit"`
}

// UpsertLeadInput is the POST /leads body the agent uses to record a prospect.
// campaign_id, company_name and domain are required (the pair dedups on
// tenant_id+domain+company_name); the rest is optional discovery data.
type UpsertLeadInput struct {
	CampaignID  string         `json:"campaign_id"`
	CompanyName string         `json:"company_name"`
	Domain      string         `json:"domain"`
	Segment     string         `json:"segment"`
	Channel     string         `json:"channel"`
	SourceURL   string         `json:"source_url"`
	Enriched    map[string]any `json:"enriched"`
}

// LeadService is the use-case layer for leads.
type LeadService struct {
	publisher CommandPublisher
	reader    LeadReader
	optOuts   OptOutReader
}

// ErrOptOutUnavailable means the LGPD guardrail reader is not wired (the pair
// is unconfigured). It is NOT a not-found: a missing opt-out is a false value,
// so the transport answers 503 here rather than 404.
var ErrOptOutUnavailable = errors.New("opt-out guardrail unavailable")

func NewLeadService(publisher CommandPublisher, reader LeadReader) *LeadService {
	return &LeadService{publisher: publisher, reader: reader, optOuts: nil}
}

// WithOptOuts wires the LGPD guardrail reader (optional; nil means "not
// configured", in which case opt-out reads 503).
func (s *LeadService) WithOptOuts(o OptOutReader) *LeadService {
	s.optOuts = o
	return s
}

// UpsertLead validates the discovery and publishes UpsertLead. Empty
// campaign_id/company_name/domain are rejected before publishing.
func (s *LeadService) UpsertLead(ctx context.Context, in UpsertLeadInput) (string, error) {
	in.CompanyName = strings.TrimSpace(in.CompanyName)
	if in.CompanyName == "" {
		return "", domain.ErrCompanyNameRequired
	}
	in.Domain = strings.TrimSpace(in.Domain)
	if in.Domain == "" {
		return "", domain.ErrDomainRequired
	}
	in.CampaignID = strings.TrimSpace(in.CampaignID)
	if in.CampaignID == "" {
		return "", domain.ErrCampaignRequired
	}
	payload := map[string]any{
		"campaign_id":  in.CampaignID,
		"company_name": in.CompanyName,
		"domain":       in.Domain,
	}
	if v := strings.TrimSpace(in.Segment); v != "" {
		payload["segment"] = v
	}
	if v := strings.TrimSpace(in.Channel); v != "" {
		payload["channel"] = v
	}
	if v := strings.TrimSpace(in.SourceURL); v != "" {
		payload["source_url"] = v
	}
	if in.Enriched != nil {
		payload["enriched"] = in.Enriched
	}
	return s.publisher.Publish(ctx, ActionUpsertLead, payload)
}

// OptOut reads the LGPD guardrail. Absent = false; never a not-found.
func (s *LeadService) OptOut(ctx context.Context, leadID string) (domain.OptOut, error) {
	leadID = strings.TrimSpace(leadID)
	if leadID == "" {
		return domain.OptOut{}, domain.ErrLeadIDRequired
	}
	if s.optOuts == nil {
		return domain.OptOut{}, ErrOptOutUnavailable
	}
	return s.optOuts.OptOut(ctx, leadID)
}

// LeadByPhone resolves a WhatsApp number back to its lead (cross-tenant). The
// number is normalized to digits only before the lookup; an empty number is
// not-found so the caller answers 404 rather than scanning for nothing.
func (s *LeadService) LeadByPhone(ctx context.Context, number string) (domain.LeadPhone, error) {
	number = normalizePhone(number)
	if number == "" {
		return domain.LeadPhone{}, domain.ErrNotFound
	}
	return s.reader.LeadByPhone(ctx, number)
}

// normalizePhone leaves only digits (E.164 without +), so a formatted inbound
// number matches the stored one.
func normalizePhone(raw string) string {
	var b strings.Builder
	for _, ch := range raw {
		if ch >= '0' && ch <= '9' {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

// QualifyLead validates the manual fit and publishes QualifyLead. A fit outside
// 0..100 (or absent) is rejected before publishing.
func (s *LeadService) QualifyLead(ctx context.Context, leadID string, in QualifyLeadInput) (string, error) {
	leadID = strings.TrimSpace(leadID)
	if leadID == "" {
		return "", domain.ErrLeadIDRequired
	}
	if in.Fit == nil || *in.Fit < 0 || *in.Fit > 100 {
		return "", domain.ErrFitOutOfRange
	}
	payload := map[string]any{
		"lead_id": leadID,
		"fit":     *in.Fit,
	}
	return s.publisher.Publish(ctx, ActionQualifyLead, payload)
}

// GetLead reads one lead projection (detail view: enriched, timeline, last
// message). A missing record is ErrNotFound.
func (s *LeadService) GetLead(ctx context.Context, id string) (domain.Lead, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.Lead{}, domain.ErrNotFound
	}
	return s.reader.Lead(ctx, id)
}

// ListLeads reads a page of leads for the filter the caller passed.
func (s *LeadService) ListLeads(ctx context.Context, f LeadFilter) (domain.Page[domain.Lead], error) {
	f.CampaignID = strings.TrimSpace(f.CampaignID)
	f.Status = strings.TrimSpace(f.Status)
	f.Cursor = strings.TrimSpace(f.Cursor)
	f.Limit = normalizeLimit(f.Limit)
	return s.reader.ListLeads(ctx, f)
}
