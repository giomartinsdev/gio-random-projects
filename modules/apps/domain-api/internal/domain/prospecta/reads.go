// Package prospecta holds domain-api's read models for the Prospecta context.
// As leituras são projeções puras sobre as tabelas que o domain-worker escreve
// (prospecta_company/prospecta_icp); domain-api é read-only aqui, como em todo
// o resto do repo.
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

// ReadRepository é a porta de leitura (só leitura: o domain-worker escreve).
type ReadRepository interface {
	GetCompany(ctx context.Context, tenantID, id string) (CompanyView, error)
	ICPByCompany(ctx context.Context, tenantID, companyID string) (ICPView, error)
}
