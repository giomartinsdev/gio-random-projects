package prospecta

import "time"

// ICP é o cliente ideal descrito em linguagem natural, sempre pertencente a
// uma Company do mesmo tenant. Signals são os gatilhos citados ("expansão de
// frota", "novo CD") que a IA usa para qualificar.
//
// Embedding é o vetor semântico (data-model: vector(1536), gerado via
// 9router). Guardado como []float32: o repositório serializa em JSONB porque o
// Postgres do repo é postgres:17-alpine, sem a extensão pgvector -- ver a nota
// de conflito no schema.sql. Fica nil nesta fatia (o embedding é do worker
// agêntico, num passo posterior).
type ICP struct {
	ID         string
	TenantID   string
	CompanyID  string
	Definition string
	Signals    []string
	Embedding  []float32
	CreatedAt  time.Time
}

// NewICP valida os invariantes: tenant, empresa de origem e a definição do ICP.
func NewICP(id, tenantID, companyID, definition string, signals []string) (ICP, error) {
	if tenantID == "" {
		return ICP{}, ErrTenantIDRequired
	}
	if companyID == "" {
		return ICP{}, ErrCompanyIDRequired
	}
	if definition == "" {
		return ICP{}, ErrDefinitionRequired
	}
	if signals == nil {
		signals = []string{}
	}
	return ICP{
		ID:         id,
		TenantID:   tenantID,
		CompanyID:  companyID,
		Definition: definition,
		Signals:    signals,
	}, nil
}
