// Package http is domain-api's interface layer. Reads (GET) call
// domain/user.Repository directly for an immediate, consistent
// response. Writes (POST/PUT/DELETE) never touch the database — they
// build an application.Command and hand it to a
// application.CommandPublisher, responding 202 Accepted. The write is
// applied asynchronously by domain-worker; see that binary's package
// doc for why.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/user"
	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/user"
)

type Handlers struct {
	users    domainuser.Repository
	commands application.CommandPublisher
	log      *slog.Logger
}

func NewHandlers(users domainuser.Repository, commands application.CommandPublisher, log *slog.Logger) *Handlers {
	return &Handlers{users: users, commands: commands, log: log}
}

func (h *Handlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.users.List(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, toUserResponses(users))
}

func (h *Handlers) GetUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, err := h.users.FindByID(r.Context(), id)
	if errors.Is(err, domainuser.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "user not found"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, toUserResponse(user))
}

func (h *Handlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	var input appuser.CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.Name == "" || input.Email == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "name and email are required"})
		return
	}
	h.publish(w, r, application.ActionCreateUser, input)
}

func (h *Handlers) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var input appuser.UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	input.ID = id
	if input.Name == "" || input.Email == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "name and email are required"})
		return
	}
	h.publish(w, r, application.ActionUpdateUser, input)
}

func (h *Handlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	h.publish(w, r, application.ActionDeleteUser, appuser.DeleteInput{ID: id})
}

// publish marshals payload into an application.Command and hands it to
// the bus — the request is accepted for processing, not yet applied.
func (h *Handlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

func (h *Handlers) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}

type errorBody struct {
	Error string `json:"error"`
}

type acceptedBody struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
