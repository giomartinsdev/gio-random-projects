// EnvelopeHandlers backs POST /commands — the asynchronous envelope door the
// house's default write path assumes (docs/finance-system-spec.md §4.1).
//
// Every other 202 route in this service takes a route-specific payload
// (UpsertClubInput and friends); this is the one route that decodes the bare
// {action, payload} envelope, so any action a worker knows about can be
// published without a dedicated Go handler per action. It publishes with a
// fresh server-side id and answers 202 immediately — who applies it is the
// domain-worker, exactly like /sync, minus the wait.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
)

type EnvelopeHandlers struct {
	commands application.CommandPublisher
	log      *slog.Logger
}

func NewEnvelopeHandlers(commands application.CommandPublisher, log *slog.Logger) *EnvelopeHandlers {
	return &EnvelopeHandlers{commands: commands, log: log}
}

// Publish accepts the house envelope and hands it to the broker.
//
// Responses:
//   - 202 {command_id, status:"accepted"} — published; the worker applies it.
//   - 400 — the body is not a valid envelope.
//   - 500 — the broker publish failed; nothing was accepted.
//
// Any client-supplied id is overwritten with a fresh server-side id, the same
// rule /sync follows: the envelope carries no authoritative id.
func (h *EnvelopeHandlers) Publish(w http.ResponseWriter, r *http.Request) {
	var cmd application.Command
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil || cmd.Action == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body: action and payload are required"})
		return
	}
	cmd.ID = uuid.NewString()

	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.log.ErrorContext(r.Context(), "publish envelope", "error", err, "action", cmd.Action)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}
