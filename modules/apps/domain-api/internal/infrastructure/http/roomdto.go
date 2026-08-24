package httpapi

import (
	"time"

	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/room"
)

type RoomResponse struct {
	ID          string    `json:"id"`
	HostID      string    `json:"host_id"`
	Title       string    `json:"title"`
	DocumentID  string    `json:"document_id"`
	CurrentPage int       `json:"current_page"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func toRoomResponse(r domainroom.Room) RoomResponse {
	return RoomResponse{
		ID: r.ID, HostID: r.HostID, Title: r.Title, DocumentID: r.DocumentID,
		CurrentPage: r.CurrentPage, Status: r.Status, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

func toRoomResponses(rooms []domainroom.Room) []RoomResponse {
	out := make([]RoomResponse, len(rooms))
	for i, r := range rooms {
		out[i] = toRoomResponse(r)
	}
	return out
}
