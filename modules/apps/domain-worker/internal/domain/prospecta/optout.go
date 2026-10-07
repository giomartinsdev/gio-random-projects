package prospecta

import (
	"time"
)

// OptOut é o registro de que um lead pediu para não ser contatado. É o guardrail
// LGPD consultado ANTES de todo envio (contrato prospecta-agent-worker): sem
// esta linha, o agente pode mandar; com ela, nunca.
//
// A chave natural é (tenant_id, lead_id): o mesmo pedido duas vezes é UMA linha.
type OptOut struct {
	ID        string
	TenantID  string
	LeadID    string
	Reason    string
	CreatedAt time.Time
}

// NewOptOut valida o pedido. tenant e lead são obrigatórios — sem eles o
// guardrail não tem a que se referir.
func NewOptOut(id, tenantID, leadID, reason string) (OptOut, error) {
	if tenantID == "" {
		return OptOut{}, ErrTenantIDRequired
	}
	if leadID == "" {
		return OptOut{}, ErrLeadIDRequired
	}
	return OptOut{
		ID:       id,
		TenantID: tenantID,
		LeadID:   leadID,
		Reason:   reason,
	}, nil
}
