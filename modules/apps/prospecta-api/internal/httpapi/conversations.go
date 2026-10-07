package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
)

// ListConversations handles GET /conversations (paginated inbox).
func (h *Handlers) ListConversations(w http.ResponseWriter, r *http.Request) {
	page, err := h.services.Messaging.ListConversations(r.Context(), intQuery(r, "limit"), r.URL.Query().Get("cursor"))
	if err != nil {
		h.writeReadError(w, r, "conversas não encontradas", "listar conversas", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// GetConversation handles GET /conversations/{id} (full thread, in order).
func (h *Handlers) GetConversation(w http.ResponseWriter, r *http.Request) {
	conv, err := h.services.Messaging.GetConversation(r.Context(), r.PathValue("id"))
	if err != nil {
		h.writeReadError(w, r, "conversa não encontrada", "ler a conversa", err)
		return
	}
	writeJSON(w, http.StatusOK, conv)
}

// CreateMessage handles POST /messages. Empty content is 422 before publishing.
func (h *Handlers) CreateMessage(w http.ResponseWriter, r *http.Request) {
	var in application.CreateMessageInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	id, err := h.services.Messaging.CreateMessage(r.Context(), in)
	if err != nil {
		h.writeCommandError(w, r, "DraftMessage", err)
		return
	}
	writeAccepted(w, id)
}

// ApproveMessage handles POST /messages/{id}/approve. The message is read from
// the pair first; anything but "drafted" is 409 and nothing is published.
func (h *Handlers) ApproveMessage(w http.ResponseWriter, r *http.Request) {
	id, err := h.services.Messaging.ApproveMessage(r.Context(), r.PathValue("id"))
	if err != nil {
		h.writeCommandError(w, r, "ApproveMessage", err)
		return
	}
	writeAccepted(w, id)
}
