package application

import (
	"context"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// QualifyLeadInput is the POST /leads/{id}/qualify body. fit is a manual
// override by the operator and must be within 0..100.
type QualifyLeadInput struct {
	Fit *int `json:"fit"`
}

// LeadService is the use-case layer for leads.
type LeadService struct {
	publisher CommandPublisher
	reader    LeadReader
}

func NewLeadService(publisher CommandPublisher, reader LeadReader) *LeadService {
	return &LeadService{publisher: publisher, reader: reader}
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
