// Package domain holds the entities and business rules of the Prospecta
// bounded context (company, ICP, campaign, lead, conversation).
//
// Pure Go, no I/O and no framework: the domain never imports infrastructure.
// The aggregates themselves are owned and persisted by the domain pair --
// this side only models enough of them to validate invariants and shape the
// projections it reads back.
package domain

import "errors"

// Validation errors. The transport maps each to a 422: they mean "the request
// is well-formed but semantically invalid", and no command was published, so
// there is never a partial write.
var (
	ErrCompanyNameRequired   = errors.New("company name is required")
	ErrCompanyIDRequired     = errors.New("company_id is required")
	ErrICPDefinitionRequired = errors.New("icp definition is required")
)

// ErrNotFound is what a read returns when the domain pair has no such record;
// the transport maps it to 404.
var ErrNotFound = errors.New("not found")

// Company is the projection of prospecta_company that this ACL models. The
// domain pair owns the row; this struct is only the shape read back.
type Company struct {
	ID          string `json:"id"`
	TenantID    string `json:"tenant_id,omitempty"`
	Name        string `json:"name"`
	Site        string `json:"site,omitempty"`
	Description string `json:"description,omitempty"`
	// ICP is nil until DefineICP has run for the company.
	ICP *ICP `json:"icp,omitempty"`
}

// ICP is the ideal-customer profile in natural language, plus the explicit
// signals the agent watches for. Mirrors prospecta_icp.
type ICP struct {
	Definition string   `json:"definition"`
	Signals    []string `json:"signals"`
}
