// Package transacao holds the concrete application.Command payloads for
// the Transacao aggregate -- domain-worker decodes the same shapes on
// the other end (its own copy of this package).
package transacao

import "time"

type CreateInput struct {
	UserEmail string    `json:"user_email"`
	ContaID      string    `json:"conta_id"`
	Kind         string    `json:"kind"`
	Categoria    string    `json:"categoria"`
	Descricao    string    `json:"descricao,omitempty"`
	AnexoImagem  string    `json:"anexo_imagem,omitempty"`
	Valor        float64   `json:"valor"`
	Data         time.Time `json:"data"`
}

type UpdateInput struct {
	ID           string     `json:"id"`
	UserEmail string     `json:"user_email"`
	ContaID      string     `json:"conta_id,omitempty"`
	Kind         string     `json:"kind,omitempty"`
	Categoria    string     `json:"categoria,omitempty"`
	Descricao    string     `json:"descricao,omitempty"`
	AnexoImagem  string     `json:"anexo_imagem,omitempty"`
	Valor        float64    `json:"valor,omitempty"`
	Data         *time.Time `json:"data,omitempty"`
}

type DeleteInput struct {
	ID           string `json:"id"`
	UserEmail string `json:"user_email"`
}
