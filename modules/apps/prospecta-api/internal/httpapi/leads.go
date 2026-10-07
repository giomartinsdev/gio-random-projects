package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
)

// ListLeads handles GET /leads?campaign_id=&status=&fit_min= (paginated).
func (h *Handlers) ListLeads(w http.ResponseWriter, r *http.Request) {
	filter := application.LeadFilter{
		CampaignID: r.URL.Query().Get("campaign_id"),
		Status:     r.URL.Query().Get("status"),
		FitMin:     intQuery(r, "fit_min"),
		Limit:      intQuery(r, "limit"),
		Cursor:     r.URL.Query().Get("cursor"),
	}
	page, err := h.services.Leads.ListLeads(r.Context(), filter)
	if err != nil {
		h.writeReadError(w, r, "leads não encontrados", "listar leads", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GetLead handles GET /leads/{id} (detail: enriched, timeline, last message).
func (h *Handlers) GetLead(w http.ResponseWriter, r *http.Request) {
	lead, err := h.services.Leads.GetLead(r.Context(), r.PathValue("id"))
	if err != nil {
		h.writeReadError(w, r, "lead não encontrado", "ler o lead", err)
		return
	}
	writeJSON(w, http.StatusOK, lead)
}

// QualifyLead handles POST /leads/{id}/qualify. fit outside 0..100 is 422 and
// nothing is published.
func (h *Handlers) QualifyLead(w http.ResponseWriter, r *http.Request) {
	var in application.QualifyLeadInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	id, err := h.services.Leads.QualifyLead(r.Context(), r.PathValue("id"), in)
	if err != nil {
		h.writeCommandError(w, r, "QualifyLead", err)
		return
	}
	writeAccepted(w, id)
}

// CreateLead handles POST /leads: the agent records a discovered prospect.
// Validates, publishes UpsertLead and answers 202 with the command id.
func (h *Handlers) CreateLead(w http.ResponseWriter, r *http.Request) {
	var in application.UpsertLeadInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	id, err := h.services.Leads.UpsertLead(r.Context(), in)
	if err != nil {
		h.writeCommandError(w, r, "UpsertLead", err)
		return
	}
	writeAccepted(w, id)
}

// GetOptOut handles GET /opt-outs/{lead_id}: the LGPD guardrail the agent
// consults before every send. It always answers 200 {opted_out} — absence is
// false, never 404.
func (h *Handlers) GetOptOut(w http.ResponseWriter, r *http.Request) {
	optOut, err := h.services.Leads.OptOut(r.Context(), r.PathValue("lead_id"))
	if err != nil {
		h.writeReadError(w, r, "opt-out não encontrado", "ler opt-out", err)
		return
	}
	writeJSON(w, http.StatusOK, optOut)
}

// GetLeadByPhone handles GET /leads/by-phone/{number}: resolves an inbound
// WhatsApp number back to its lead. Cross-tenant by design; 404 when no lead
// matches.
func (h *Handlers) GetLeadByPhone(w http.ResponseWriter, r *http.Request) {
	lead, err := h.services.Leads.LeadByPhone(r.Context(), r.PathValue("number"))
	if err != nil {
		h.writeReadError(w, r, "lead não encontrado", "resolver lead por telefone", err)
		return
	}
	writeJSON(w, http.StatusOK, lead)
}
