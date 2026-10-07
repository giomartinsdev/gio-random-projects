package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
)

// CreateCampaign handles POST /campaigns. Validates, publishes CreateCampaign,
// answers 202 with the command id.
func (h *Handlers) CreateCampaign(w http.ResponseWriter, r *http.Request) {
	var in application.CreateCampaignInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	id, err := h.services.Campaigns.CreateCampaign(r.Context(), in)
	if err != nil {
		h.writeCommandError(w, r, "CreateCampaign", err)
		return
	}
	writeAccepted(w, id)
}

// ListCampaigns handles GET /campaigns (paginated).
func (h *Handlers) ListCampaigns(w http.ResponseWriter, r *http.Request) {
	page, err := h.services.Campaigns.ListCampaigns(r.Context(), intQuery(r, "limit"), r.URL.Query().Get("cursor"))
	if err != nil {
		h.writeReadError(w, r, "campanhas não encontradas", "listar campanhas", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GetCampaign handles GET /campaigns/{id}. A missing campaign is 404.
func (h *Handlers) GetCampaign(w http.ResponseWriter, r *http.Request) {
	campaign, err := h.services.Campaigns.GetCampaign(r.Context(), r.PathValue("id"))
	if err != nil {
		h.writeReadError(w, r, "campanha não encontrada", "ler a campanha", err)
		return
	}
	writeJSON(w, http.StatusOK, campaign)
}

// StartCampaign handles POST /campaigns/{id}/start. The service reads the
// campaign and refuses one without an ICP (422); on success it publishes
// StartCampaign and RequestProspect and answers 202.
func (h *Handlers) StartCampaign(w http.ResponseWriter, r *http.Request) {
	id, err := h.services.Campaigns.StartCampaign(r.Context(), r.PathValue("id"))
	if err != nil {
		h.writeCommandError(w, r, "StartCampaign", err)
		return
	}
	writeAccepted(w, id)
}
