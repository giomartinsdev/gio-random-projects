package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	goredis "github.com/redis/go-redis/v9"
)

// domainEventsChannel must match domain-worker's own processedChannel
// (internal/infrastructure/redis/redis.go on that side) -- duplicated
// deliberately, same "each module owns its copy" convention as
// commandChannel already follows between these two binaries.
const domainEventsChannel = "domain.events"

// SSEHandlers relays domain-worker's shared event bus out over
// Server-Sent Events, filtered to one room. Only bookclub-api's own
// Node process calls this today, not a browser directly -- SSE can't
// carry a custom request header from a browser's EventSource, and
// this route needs the same X-API-Key every other route here does, so
// it has to be a server-to-server subscriber that then re-broadcasts
// to its own WebSocket clients. See that service's README for the
// other half of this.
type SSEHandlers struct {
	rdb *goredis.Client
	log Logger
}

func NewSSEHandlers(rdb *goredis.Client, log Logger) *SSEHandlers {
	return &SSEHandlers{rdb: rdb, log: log}
}

// StreamRoomEvents relays every domain.events message whose payload
// has a matching "room_id" field -- generic across every event type
// that carries one (room.created/updated/deleted, message.created).
// This handler has no idea those event types exist beyond that one
// shared field name.
func (h *SSEHandlers) StreamRoomEvents(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "id")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "streaming unsupported"})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ctx := r.Context()
	sub := h.rdb.Subscribe(ctx, domainEventsChannel)
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}

			var envelope struct {
				EventName string          `json:"event_name"`
				Payload   json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal([]byte(msg.Payload), &envelope); err != nil {
				h.log.Error("sse: decode envelope failed", "error", err)
				continue
			}

			var probe struct {
				RoomID string `json:"room_id"`
			}
			if err := json.Unmarshal(envelope.Payload, &probe); err != nil || probe.RoomID != roomID {
				continue
			}

			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", envelope.EventName, envelope.Payload); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
