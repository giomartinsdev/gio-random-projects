package httpapi

import (
	"time"

	domaintransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/transacao"
)

type TransacaoResponse struct {
	ID           string    `json:"id"`
	UsuarioEmail string    `json:"usuario_email"`
	ContaID      string    `json:"conta_id"`
	Tipo         string    `json:"tipo"`
	Categoria    string    `json:"categoria"`
	Descricao    string    `json:"descricao,omitempty"`
	AnexoImagem  string    `json:"anexo_imagem,omitempty"`
	Valor        float64   `json:"valor"`
	Data         time.Time `json:"data"`
	CriadoEm     time.Time `json:"criado_em"`
	AtualizadoEm time.Time `json:"atualizado_em"`
}

func toTransacaoResponse(t domaintransacao.Transacao) TransacaoResponse {
	return TransacaoResponse{
		ID: t.ID, UsuarioEmail: t.UsuarioEmail, ContaID: t.ContaID, Tipo: t.Tipo, Categoria: t.Categoria,
		Descricao: t.Descricao, AnexoImagem: t.AnexoImagem, Valor: t.Valor, Data: t.Data,
		CriadoEm: t.CriadoEm, AtualizadoEm: t.AtualizadoEm,
	}
}

func toTransacaoResponses(transacoes []domaintransacao.Transacao) []TransacaoResponse {
	out := make([]TransacaoResponse, len(transacoes))
	for i, t := range transacoes {
		out[i] = toTransacaoResponse(t)
	}
	return out
}
