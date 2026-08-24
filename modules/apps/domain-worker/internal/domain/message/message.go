// Package message is the domain layer for a Room's chat messages.
// Create-only (no Edit/Delete) -- a chat log is append-only, and
// "requested page N" is just a nullable field on the message, not a
// different kind of entity or a rule this package enforces. Whether a
// requested-page message gets acted on is entirely bookclub-api's
// concern (only it knows what "the host" means for a WebSocket
// session); this package doesn't know that concept exists.
package message

import (
	"errors"
	"time"
)

var (
	ErrRoomRequired = errors.New("room_id is required")
	ErrUserRequired = errors.New("user_id is required")
	ErrBodyRequired = errors.New("body is required")
	ErrInvalidPage  = errors.New("requested_page must be at least 1")
)

type Message struct {
	ID            string
	RoomID        string
	UserID        string
	UserName      string
	Body          string
	RequestedPage *int
	CreatedAt     time.Time
}

func New(id, roomID, userID, userName, body string, requestedPage *int) (Message, error) {
	if roomID == "" {
		return Message{}, ErrRoomRequired
	}
	if userID == "" {
		return Message{}, ErrUserRequired
	}
	if body == "" {
		return Message{}, ErrBodyRequired
	}
	if requestedPage != nil && *requestedPage < 1 {
		return Message{}, ErrInvalidPage
	}

	return Message{
		ID:            id,
		RoomID:        roomID,
		UserID:        userID,
		UserName:      userName,
		Body:          body,
		RequestedPage: requestedPage,
		CreatedAt:     time.Now().UTC(),
	}, nil
}
