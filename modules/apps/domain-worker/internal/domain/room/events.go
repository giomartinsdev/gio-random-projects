package room

import "time"

// Event is implemented by every domain event this aggregate raises.
// Every event carries RoomID as a plain JSON field named "room_id" --
// domain-api's SSE relay (internal/infrastructure/http/sse.go on that
// side) filters the shared domain.events stream on exactly that field,
// generic across every aggregate that ever wants a per-room stream.
type Event interface {
	EventName() string
}

type Created struct {
	RoomID     string    `json:"room_id"`
	HostID     string    `json:"host_id"`
	Title      string    `json:"title"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "room.created" }

// Updated carries the full current state (not just what changed) so a
// subscriber never needs a follow-up GET to render it -- CurrentPage
// in particular is the one field a live viewer needs the instant it
// changes.
type Updated struct {
	RoomID      string    `json:"room_id"`
	HostID      string    `json:"host_id"`
	Title       string    `json:"title"`
	CurrentPage int       `json:"current_page"`
	OccurredAt  time.Time `json:"occurred_at"`
}

func (Updated) EventName() string { return "room.updated" }

type Deleted struct {
	RoomID     string    `json:"room_id"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Deleted) EventName() string { return "room.deleted" }
