// Package prospecta é a camada de domínio do primeiro agregado do Prospecta
// (specs/004-prospecta): a Company cadastrada e o seu ICP. Mesma forma de
// domain/club e domain/finance -- tipos Go puros e invariantes, sem banco e
// sem HTTP. A persistência é exclusiva do par domain-api/domain-worker (§1.1).
package prospecta

import (
	"errors"
	"time"
)

var (
	ErrTenantIDRequired   = errors.New("tenant_id is required")
	ErrNameRequired       = errors.New("name is required")
	ErrCompanyIDRequired  = errors.New("company_id is required")
	ErrDefinitionRequired = errors.New("definition is required")
)

// Company é a empresa que prospecta. tenant_id é a chave do multi-tenant (RLS
// no banco); id é sempre UUID gerado por quem aplica o comando, nunca pela ACL.
type Company struct {
	ID          string
	TenantID    string
	Name        string
	Site        string
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// NewCompany valida os invariantes do agregado: toda empresa pertence a um
// tenant e tem nome (a IA usa o nome e a descrição para contextualizar).
func NewCompany(id, tenantID, name, site, description string) (Company, error) {
	if tenantID == "" {
		return Company{}, ErrTenantIDRequired
	}
	if name == "" {
		return Company{}, ErrNameRequired
	}
	return Company{
		ID:          id,
		TenantID:    tenantID,
		Name:        name,
		Site:        site,
		Description: description,
	}, nil
}
