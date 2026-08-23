package httpapi

import (
	"time"

	domainuser "github.com/giomartinsdev/gio-random-projects/api/domain/src/domain/user"
)

// UserResponse is the wire shape for a User — kept separate from
// domain/user.User on purpose: the domain entity has no JSON tags
// (serialization is an interface-layer concern, not a domain one), and
// this is the one place that maps between the two.
type UserResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toUserResponse(u domainuser.User) UserResponse {
	return UserResponse{ID: u.ID, Name: u.Name, Email: u.Email, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt}
}

func toUserResponses(users []domainuser.User) []UserResponse {
	out := make([]UserResponse, len(users))
	for i, u := range users {
		out[i] = toUserResponse(u)
	}
	return out
}
