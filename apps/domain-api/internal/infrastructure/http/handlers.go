// Package http is domain-api's interface layer. Reads (GET) call the
// clubs repositories directly for an immediate, consistent response.
// Writes either go through POST /sync — the caller polls audit_log to
// confirm the record landed — or, for the append-only high-volume
// streams, build an application.Command and hand it to an
// application.CommandPublisher, responding 202 Accepted. Those are
// applied asynchronously by domain-worker.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

type Handlers struct {
	log *slog.Logger
}

func NewHandlers(log *slog.Logger) *Handlers {
	return &Handlers{log: log}
}

func (h *Handlers) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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
