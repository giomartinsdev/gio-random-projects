package httpapi

import (
	"time"

	domainconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/conta"
)

type ContaResponse struct {
	ID           string    `json:"id"`
	UserEmail string    `json:"user_email"`
	Name         string    `json:"name"`
	Kind         string    `json:"kind"`
	Status       string    `json:"status"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toContaResponse(c domainconta.Conta) ContaResponse {
	return ContaResponse{
		ID: c.ID, UserEmail: c.UserEmail, Name: c.Name, Kind: c.Kind, Status: c.Status,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

func toContaResponses(contas []domainconta.Conta) []ContaResponse {
	out := make([]ContaResponse, len(contas))
	for i, c := range contas {
		out[i] = toContaResponse(c)
	}
	return out
}
