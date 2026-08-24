package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	approom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/room"
	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/room"
)

// RoomHandlers is separate from Handlers/PostHandlers on purpose --
// each aggregate gets its own dependencies. Room is generic ("a room
// has a host and a current page") on purpose: bookclub-specific rules
// like "only the host may turn the page" are enforced by bookclub-api
// before it ever calls here, not by domain-api/domain-worker.
type RoomHandlers struct {
	rooms    domainroom.Repository
	commands application.CommandPublisher
	log      Logger
}

func NewRoomHandlers(rooms domainroom.Repository, commands application.CommandPublisher, log Logger) *RoomHandlers {
	return &RoomHandlers{rooms: rooms, commands: commands, log: log}
}

func (h *RoomHandlers) ListRooms(w http.ResponseWriter, r *http.Request) {
	rooms, err := h.rooms.ListAll(r.Context())
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": toRoomResponses(rooms)})
}

func (h *RoomHandlers) GetRoom(w http.ResponseWriter, r *http.Request) {
	room, err := h.rooms.FindByID(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, domainroom.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "room not found"})
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toRoomResponse(room))
}

func (h *RoomHandlers) CreateRoom(w http.ResponseWriter, r *http.Request) {
	var input approom.CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.HostID == "" || input.Title == "" || input.DocumentID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "host_id, title and document_id are required"})
		return
	}
	h.publish(w, r, application.ActionCreateRoom, input)
}

func (h *RoomHandlers) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	var input approom.UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	input.ID = chi.URLParam(r, "id")
	if input.HostID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "host_id is required"})
		return
	}
	h.publish(w, r, application.ActionUpdateRoom, input)
}

func (h *RoomHandlers) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	var input approom.DeleteInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	input.ID = chi.URLParam(r, "id")
	if input.HostID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "host_id is required"})
		return
	}
	h.publish(w, r, application.ActionDeleteRoom, input)
}

func (h *RoomHandlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.internalError(w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

func (h *RoomHandlers) internalError(w http.ResponseWriter, err error) {
	h.log.Error("internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
