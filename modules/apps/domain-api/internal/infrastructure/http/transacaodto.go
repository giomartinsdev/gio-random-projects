package httpapi

import (
	"time"

	domaintransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/transacao"
)

type TransacaoResponse struct {
	ID           string    `json:"id"`
	UserEmail string    `json:"user_email"`
	ContaID      string    `json:"conta_id"`
	Kind         string    `json:"kind"`
	Categoria    string    `json:"categoria"`
	Descricao    string    `json:"descricao,omitempty"`
	AnexoImagem  string    `json:"anexo_imagem,omitempty"`
	Valor        float64   `json:"valor"`
	Data         time.Time `json:"data"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toTransacaoResponse(t domaintransacao.Transacao) TransacaoResponse {
	return TransacaoResponse{
		ID: t.ID, UserEmail: t.UserEmail, ContaID: t.ContaID, Kind: t.Kind, Categoria: t.Categoria,
		Descricao: t.Descricao, AnexoImagem: t.AnexoImagem, Valor: t.Valor, Data: t.Data,
		CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
}

func toTransacaoResponses(transacoes []domaintransacao.Transacao) []TransacaoResponse {
	out := make([]TransacaoResponse, len(transacoes))
	for i, t := range transacoes {
		out[i] = toTransacaoResponse(t)
	}
	return out
}
