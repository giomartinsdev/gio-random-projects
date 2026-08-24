// Package message holds the concrete application.Command payload for
// the Message aggregate -- domain-worker decodes the same shape on the
// other end (its own copy of this package).
package message

type CreateInput struct {
	RoomID        string `json:"room_id"`
	UserID        string `json:"user_id"`
	UserName      string `json:"user_name"`
	Body          string `json:"body"`
	RequestedPage *int   `json:"requested_page,omitempty"`
}
