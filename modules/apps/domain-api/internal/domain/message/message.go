// Package message is the domain layer for a Room's chat messages as
// seen from domain-api: read-only, same split as domain/room.
package message

import "time"

type Message struct {
	ID            string
	RoomID        string
	UserID        string
	UserName      string
	Body          string
	RequestedPage *int
	CreatedAt     time.Time
}
