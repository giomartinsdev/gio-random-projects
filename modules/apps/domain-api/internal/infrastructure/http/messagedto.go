package httpapi

import (
	"time"

	domainmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/message"
)

type MessageResponse struct {
	ID            string    `json:"id"`
	RoomID        string    `json:"room_id"`
	UserID        string    `json:"user_id"`
	UserName      string    `json:"user_name"`
	Body          string    `json:"body"`
	RequestedPage *int      `json:"requested_page,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

func toMessageResponse(m domainmessage.Message) MessageResponse {
	return MessageResponse{
		ID: m.ID, RoomID: m.RoomID, UserID: m.UserID, UserName: m.UserName,
		Body: m.Body, RequestedPage: m.RequestedPage, CreatedAt: m.CreatedAt,
	}
}

func toMessageResponses(messages []domainmessage.Message) []MessageResponse {
	out := make([]MessageResponse, len(messages))
	for i, m := range messages {
		out[i] = toMessageResponse(m)
	}
	return out
}
