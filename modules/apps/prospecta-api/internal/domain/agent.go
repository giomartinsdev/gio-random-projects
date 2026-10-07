package domain

// OptOut is the LGPD guardrail projection: whether a lead asked not to be
// contacted. Absence of a record means false — the pair always answers, never
// 404s.
type OptOut struct {
	OptedOut bool `json:"opted_out"`
}

// LeadPhone resolves a WhatsApp number back to the lead that owns it. The
// number lives in prospecta_lead.enriched->>'phone'; the lookup is
// cross-tenant on purpose (an inbound Evolution payload carries no tenant).
type LeadPhone struct {
	TenantID  string `json:"tenant_id"`
	LeadID    string `json:"lead_id"`
	ThreadKey string `json:"thread_key"`
}

// ValidAgentRunState says whether s is one of the contract's run states.
func ValidAgentRunState(s string) bool {
	switch s {
	case "running", "done", "failed":
		return true
	default:
		return false
	}
}
