// Package apihttp is domain-api's HTTP layer. Reads (GET) go straight
// to Postgres via userrepo for an immediate, consistent response.
// Writes (POST/PUT/DELETE) never touch the database directly — they're
// published as Commands onto the event bus and applied asynchronously
// by domain-worker, which is the architecture's whole point: the API
// stays up and responsive even if the worker or the database is
// temporarily down, at the cost of writes not being visible to a GET
// until the worker has processed them.
package apihttp

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/events"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/models"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/userrepo"
)

type Handlers struct {
	users *userrepo.Repository
	bus   *events.Bus
	log   *slog.Logger
}

func NewHandlers(users *userrepo.Repository, bus *events.Bus, log *slog.Logger) *Handlers {
	return &Handlers{users: users, bus: bus, log: log}
}

func (h *Handlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.users.List(r.Context())
	if err != nil {
		h.internalError(w, err)
		return
	}
	if users == nil {
		users = []models.User{}
	}
	writeJSON(w, http.StatusOK, users)
}

func (h *Handlers) GetUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	user, err := h.users.Get(r.Context(), id)
	if errors.Is(err, userrepo.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "user not found"})
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *Handlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	var input models.UserInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.Name == "" || input.Email == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "name and email are required"})
		return
	}

	cmd := events.Command{
		ID:         uuid.NewString(),
		EntityType: "user",
		EntityID:   uuid.NewString(),
		Action:     events.ActionCreate,
		Payload:    input,
	}
	h.publish(w, r, cmd)
}

func (h *Handlers) UpdateUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var input models.UserInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.Name == "" || input.Email == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "name and email are required"})
		return
	}

	cmd := events.Command{
		ID:         uuid.NewString(),
		EntityType: "user",
		EntityID:   id,
		Action:     events.ActionUpdate,
		Payload:    input,
	}
	h.publish(w, r, cmd)
}

func (h *Handlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cmd := events.Command{
		ID:         uuid.NewString(),
		EntityType: "user",
		EntityID:   id,
		Action:     events.ActionDelete,
	}
	h.publish(w, r, cmd)
}

// publish hands a Command to the bus and responds 202 — the request is
// accepted for processing, not yet applied. There's no ID to hand back
// for a GET-after-write beyond the command's own ID, since the actual
// row (or its deletion) doesn't exist until domain-worker gets to it.
func (h *Handlers) publish(w http.ResponseWriter, r *http.Request, cmd events.Command) {
	if err := h.bus.PublishCommand(r.Context(), cmd); err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

func (h *Handlers) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) internalError(w http.ResponseWriter, err error) {
	h.log.Error("internal error", "error", err)
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
