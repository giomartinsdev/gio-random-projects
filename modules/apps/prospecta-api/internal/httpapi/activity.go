package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// AgentActivity handles GET /agent/activity: a Server-Sent Events stream of
// live agent_run samples, per the contract:
//
//	event: agent
//	data: {"run_id":"...","agent":"prospector","state":"running","metric":{...}}
//
// The request context is the stream's lifetime: when the client disconnects,
// r.Context() is cancelled, the reader closes its channel, the range below ends
// and this handler returns -- no goroutine survives the connection.
func (h *Handlers) AgentActivity(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming não suportado")
		return
	}

	events, err := h.services.Activity.Stream(r.Context())
	if err != nil {
		h.writeReadError(w, r, "feed de atividade indisponível", "abrir o feed de atividade", err)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, open := <-events:
			if !open {
				return
			}
			payload, err := json.Marshal(ev)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "event: agent\ndata: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
