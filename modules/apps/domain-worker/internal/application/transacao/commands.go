// Package transacao holds the concrete application.Command payloads
// for the Transacao aggregate -- domain-api decodes the same shapes on
// the other end (its own copy of this package, used only to build
// outgoing commands, never to decode).
package transacao

import "time"

type CreateInput struct {
	UserEmail string    `json:"user_email"`
	ContaID      string    `json:"conta_id"`
	Kind         string    `json:"kind"`
	Valor        float64   `json:"valor"`
	Data         time.Time `json:"data"`
	Categoria    string    `json:"categoria"`
	Descricao    string    `json:"descricao,omitempty"`
	AnexoImagem  string    `json:"anexo_imagem,omitempty"`
}

type UpdateInput struct {
	ID           string     `json:"id"`
	UserEmail string     `json:"user_email"`
	Kind         string     `json:"kind,omitempty"`
	Valor        *float64   `json:"valor,omitempty"`
	Data         *time.Time `json:"data,omitempty"`
	Categoria    string     `json:"categoria,omitempty"`
	Descricao    string     `json:"descricao,omitempty"`
	AnexoImagem  string     `json:"anexo_imagem,omitempty"`
}

type DeleteInput struct {
	ID           string `json:"id"`
	UserEmail string `json:"user_email"`
}
