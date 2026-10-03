package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
)

// SyncHandlers backs POST /sync — THE EXCEPTION, not the pattern.
//
// The platform's default write path is async: POST → publish the
// Command → 202 Accepted → domain-worker applies it whenever it gets to
// it. That is what every service should use; this route exists only for
// the rare caller that cannot proceed until the write is durably
// applied (cch-api's room registry: a restart right after "create room"
// must find the room, or the host loses it). If you are adding a new
// write and are not sure you need this, you don't — use the 202 path.
//
// Mechanically it is the async path plus a wait loop: it publishes the
// exact same Command envelope onto the exact same broker, then polls
// audit_log by command_id — the worker writes one audit row per command
// unconditionally, success or failure, so that row is the proof the
// command was applied (or rejected), not merely queued. When the row
// shows up the HTTP response carries the outcome; until then the
// request just stays open.
//
// Deliberately NOT here: an action allowlist. Any action the worker
// knows about works; an unknown action still gets an audit row (success
// = false, "unknown action"), so the caller sees the rejection as a 422
// with the worker's own error instead of a silent success.
type SyncHandlers struct {
	commands application.CommandPublisher
	audits   AuditReader
	log      *slog.Logger
}

// AuditReader is the sync route's read slice over audit_log — the
// worker's audit writes are the contract this route waits on.
type AuditReader interface {
	CommandOutcome(ctx context.Context, commandID string) (found, success bool, detail string, err error)
}

func NewSyncHandlers(commands application.CommandPublisher, audits AuditReader, log *slog.Logger) *SyncHandlers {
	return &SyncHandlers{commands: commands, audits: audits, log: log}
}

// Vars, not consts, so the tests can shorten the wait — production
// values are what the comments describe.
var (
	// syncPollInterval keeps the worst-case added latency at a couple of
	// ticks around the worker's actual processing time (single-digit
	// milliseconds once the command is dequeued) without hammering
	// Postgres.
	syncPollInterval = 150 * time.Millisecond
	// syncTimeout bounds how long the HTTP request stays open. domain-api's
	// http.Server has no WriteTimeout precisely so this can outlive 10s.
	// It is NOT a durability deadline: on timeout the command is still
	// queued behind a busy or down worker and may still be applied — the
	// 504 body says so explicitly.
	syncTimeout = 10 * time.Second
)

// syncBody carries whichever of the three outcomes applies: written
// fills entity_id, failed fills error, queued fills error with the
// "still coming" explanation.
type syncBody struct {
	CommandID string `json:"command_id"`
	Status    string `json:"status"`
	EntityID  string `json:"entity_id,omitempty"`
	Error     string `json:"error,omitempty"`
}

// Sync accepts the same Command envelope every other write route uses
// ({ "action": "...", "payload": { ... } }), republishes it with a
// fresh server-side id (any client-supplied id is overwritten — the id
// must be the one this process can poll for), and blocks until the
// worker's audit row lands.
//
// Responses:
//   - 200 {command_id, status:"written", entity_id} — applied.
//   - 422 {command_id, status:"failed", error} — the worker rejected
//     it (validation, unknown action, ...); retrying unchanged will
//     fail the same way.
//   - 504 {command_id, status:"queued"} — gave up waiting. Timeout is
//     not failure: the command stays queued and may still be written.
//     Treat "written" as the only confirmation.
func (h *SyncHandlers) Sync(w http.ResponseWriter, r *http.Request) {
	var cmd application.Command
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil || cmd.Action == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body: action and payload are required"})
		return
	}
	cmd.ID = uuid.NewString()

	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.log.ErrorContext(r.Context(), "sync: publish failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}

	deadline := time.Now().Add(syncTimeout)
	ticker := time.NewTicker(syncPollInterval)
	defer ticker.Stop()
	for {
		found, success, detail, err := h.audits.CommandOutcome(r.Context(), cmd.ID)
		if err != nil {
			// A read error is not an outcome — keep polling until the
			// deadline rather than answering "failed" off a transient
			// Postgres hiccup.
			h.log.ErrorContext(r.Context(), "sync: audit poll failed", "command_id", cmd.ID, "error", err)
		} else if found {
			if success {
				writeJSON(w, http.StatusOK, syncBody{CommandID: cmd.ID, Status: "written", EntityID: detail})
			} else {
				writeJSON(w, http.StatusUnprocessableEntity, syncBody{CommandID: cmd.ID, Status: "failed", Error: detail})
			}
			return
		}
		if time.Now().After(deadline) {
			writeJSON(w, http.StatusGatewayTimeout, syncBody{
				CommandID: cmd.ID,
				Status:    "queued",
				Error:     "worker did not finish the command within 10s — it stays queued and may still land",
			})
			return
		}
		select {
		case <-ticker.C:
		case <-r.Context().Done():
			// Client gave up (or ingress did). The published command is
			// unaffected — same semantics as a 504, just without a body.
			return
		}
	}
}
