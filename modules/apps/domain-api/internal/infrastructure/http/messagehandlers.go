package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/message"
	domainmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/message"
)

type MessageHandlers struct {
	messages domainmessage.Repository
	commands application.CommandPublisher
	log      Logger
}

func NewMessageHandlers(messages domainmessage.Repository, commands application.CommandPublisher, log Logger) *MessageHandlers {
	return &MessageHandlers{messages: messages, commands: commands, log: log}
}

// ListMessages requires ?room_id= -- there is no "list every message
// ever sent" use case, only "this room's history".
func (h *MessageHandlers) ListMessages(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	if roomID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "room_id query param is required"})
		return
	}
	messages, err := h.messages.ListByRoom(r.Context(), roomID)
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": toMessageResponses(messages)})
}

func (h *MessageHandlers) CreateMessage(w http.ResponseWriter, r *http.Request) {
	var input appmessage.CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.RoomID == "" || input.UserID == "" || input.Body == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "room_id, user_id and body are required"})
		return
	}

	raw, err := json.Marshal(input)
	if err != nil {
		h.internalError(w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: application.ActionCreateMessage, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

func (h *MessageHandlers) internalError(w http.ResponseWriter, err error) {
	h.log.Error("internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
