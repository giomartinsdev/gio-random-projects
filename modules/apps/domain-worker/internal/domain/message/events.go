package message

import "time"

type Event interface {
	EventName() string
}

// Created carries the full message, not just its ID, so bookclub-api's
// SSE subscriber can broadcast to a room's WebSocket participants
// without a follow-up GET -- same reasoning as room.Updated.
type Created struct {
	MessageID     string    `json:"message_id"`
	RoomID        string    `json:"room_id"`
	UserID        string    `json:"user_id"`
	UserName      string    `json:"user_name"`
	Body          string    `json:"body"`
	RequestedPage *int      `json:"requested_page,omitempty"`
	OccurredAt    time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "message.created" }
