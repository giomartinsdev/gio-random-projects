package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
)

// UpdateAgentRun handles POST /agent/runs/{id}: the agent closes the run that
// RequestProspect opened. The run id comes from the ProspectRequested event;
// this endpoint never creates a run (there is no POST /agent/runs). An invalid
// state is 422 and nothing is published.
func (h *Handlers) UpdateAgentRun(w http.ResponseWriter, r *http.Request) {
	var in application.UpdateAgentRunInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	id, err := h.services.Agent.UpdateAgentRun(r.Context(), r.PathValue("id"), in)
	if err != nil {
		h.writeCommandError(w, r, "UpdateAgentRun", err)
		return
	}
	writeAccepted(w, id)
}
