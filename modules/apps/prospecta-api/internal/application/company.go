// Package application holds the use cases of prospecta-api: the read paths
// (GET projections via the domain pair) and the write paths (validate, then
// publish the {action, payload} command envelope and answer 202).
//
// It depends on the domain and on ports (interfaces) declared here; the
// concrete adapters live in internal/infrastructure.
package application

import (
	"context"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// Command actions published to the domain pair. The names are the contract
// from specs/004-prospecta/contracts/domain-api-extensions.md; the worker on
// the other end routes on them.
const (
	ActionCreateCompany = "CreateCompany"
	ActionDefineICP     = "DefineICP"

	// Campaign & Lead commands.
	ActionCreateCampaign  = "CreateCampaign"
	ActionStartCampaign   = "StartCampaign"
	ActionRequestProspect = "RequestProspect"
	ActionQualifyLead     = "QualifyLead"

	// Messaging commands.
	ActionDraftMessage   = "DraftMessage"
	ActionApproveMessage = "ApproveMessage"
)

// CreateCompanyInput is the POST /companies body. tenant_id is not part of
// the public contract yet (single-tenant MVP); the domain pair fills it.
type CreateCompanyInput struct {
	Name        string `json:"name"`
	Site        string `json:"site"`
	Description string `json:"description"`
}

// DefineICPInput is the POST /companies/{id}/icp body. company_id comes from
// the path, not the body, so a client cannot target a different company.
type DefineICPInput struct {
	Definition string   `json:"definition"`
	Signals    []string `json:"signals"`
}

// CompanyService is the use-case layer for the Company + ICP slice.
type CompanyService struct {
	publisher CommandPublisher
	reader    CompanyReader
}

func NewCompanyService(publisher CommandPublisher, reader CompanyReader) *CompanyService {
	return &CompanyService{publisher: publisher, reader: reader}
}

// CreateCompany validates the input and publishes CreateCompany, returning the
// command id. An invalid name is rejected BEFORE publishing, so there is never
// a partial write.
func (s *CompanyService) CreateCompany(ctx context.Context, in CreateCompanyInput) (string, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return "", domain.ErrCompanyNameRequired
	}
	payload := map[string]any{
		"name":        in.Name,
		"site":        strings.TrimSpace(in.Site),
		"description": strings.TrimSpace(in.Description),
	}
	return s.publisher.Publish(ctx, ActionCreateCompany, payload)
}

// DefineICP validates the definition and publishes DefineICP for the company
// named by the path. An empty definition is rejected before publishing.
func (s *CompanyService) DefineICP(ctx context.Context, companyID string, in DefineICPInput) (string, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return "", domain.ErrCompanyIDRequired
	}
	in.Definition = strings.TrimSpace(in.Definition)
	if in.Definition == "" {
		return "", domain.ErrICPDefinitionRequired
	}
	signals := in.Signals
	if signals == nil {
		// The worker expects an array; null would decode differently on the
		// other side. An absent list means "no extra signals".
		signals = []string{}
	}
	payload := map[string]any{
		"company_id": companyID,
		"definition": in.Definition,
		"signals":    signals,
	}
	return s.publisher.Publish(ctx, ActionDefineICP, payload)
}

// GetCompany reads a company projection (with its ICP, when defined). A
// missing record surfaces as domain.ErrNotFound.
func (s *CompanyService) GetCompany(ctx context.Context, id string) (domain.Company, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.Company{}, domain.ErrNotFound
	}
	return s.reader.Company(ctx, id)
}
