package httpapi

import (
	"time"

	domainconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/conta"
)

type ContaResponse struct {
	ID           string    `json:"id"`
	UsuarioEmail string    `json:"usuario_email"`
	Nome         string    `json:"nome"`
	Tipo         string    `json:"tipo"`
	Status       string    `json:"status"`
	CriadoEm     time.Time `json:"criado_em"`
	AtualizadoEm time.Time `json:"atualizado_em"`
}

func toContaResponse(c domainconta.Conta) ContaResponse {
	return ContaResponse{
		ID: c.ID, UsuarioEmail: c.UsuarioEmail, Nome: c.Nome, Tipo: c.Tipo, Status: c.Status,
		CriadoEm: c.CriadoEm, AtualizadoEm: c.AtualizadoEm,
	}
}

func toContaResponses(contas []domainconta.Conta) []ContaResponse {
	out := make([]ContaResponse, len(contas))
	for i, c := range contas {
		out[i] = toContaResponse(c)
	}
	return out
}
