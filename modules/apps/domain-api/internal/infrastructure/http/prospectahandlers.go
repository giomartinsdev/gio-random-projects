// prospecta handlers: domain-api's surface for the Prospecta context
// (specs/004-prospecta). Reads are projections straight from Postgres (só
// leitura; o domain-worker escreve); writes build the {action, payload}
// envelope and answer 202 — the sync path stays for callers that must wait.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/prospecta"
	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/prospecta"
)

type ProspectaHandlers struct {
	reads    domainprospecta.ReadRepository
	commands application.CommandPublisher
	log      *slog.Logger
}

func NewProspectaHandlers(reads domainprospecta.ReadRepository, commands application.CommandPublisher, log *slog.Logger) *ProspectaHandlers {
	return &ProspectaHandlers{reads: reads, commands: commands, log: log}
}

// CreateCompany é o POST /companies: valida o mínimo na borda e publica o
// comando CreateCompany. 202 na hora — quem aplica é o domain-worker.
func (h *ProspectaHandlers) CreateCompany(w http.ResponseWriter, r *http.Request) {
	var in appprospecta.CreateCompanyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.TenantID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "tenant_id is required"})
		return
	}
	if in.Name == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "name is required"})
		return
	}
	h.publish(w, r, application.ActionCreateCompany, in)
}

// DefineICP é o POST /companies/{companyId}/icp.
func (h *ProspectaHandlers) DefineICP(w http.ResponseWriter, r *http.Request) {
	var in appprospecta.DefineICPInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	in.CompanyID = chi.URLParam(r, "companyId")
	if in.TenantID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "tenant_id is required"})
		return
	}
	if in.CompanyID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "company_id is required"})
		return
	}
	if in.Definition == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "definition is required"})
		return
	}
	h.publish(w, r, application.ActionDefineICP, in)
}

// GetCompany é o GET /companies/{id}?tenant_id=...: a projeção da empresa com
// o ICP quando já definido.
func (h *ProspectaHandlers) GetCompany(w http.ResponseWriter, r *http.Request) {
	tenantID := r.URL.Query().Get("tenant_id")
	if tenantID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "tenant_id is required"})
		return
	}
	company, err := h.reads.GetCompany(r.Context(), tenantID, chi.URLParam(r, "id"))
	if errors.Is(err, domainprospecta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "company not found"})
		return
	}
	if err != nil {
		h.log.ErrorContext(r.Context(), "prospecta get company", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	writeJSON(w, http.StatusOK, company)
}

func (h *ProspectaHandlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.log.ErrorContext(r.Context(), "marshal prospecta command", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.log.ErrorContext(r.Context(), "publish prospecta command", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}
