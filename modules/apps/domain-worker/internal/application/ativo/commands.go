// Package ativo holds the concrete application.Command payloads for
// the Ativo aggregate (and its AtivoMovimento child records) --
// domain-api decodes the same shapes on the other end (its own copy of
// this package, used only to build outgoing commands, never to
// decode).
package ativo

import "time"

type CreateInput struct {
	UserEmail      string    `json:"user_email"`
	ContaID           string    `json:"conta_id"`
	Ticker            string    `json:"ticker"`
	QuantidadeInicial float64   `json:"quantidade_inicial"`
	PrecoUnitario     float64   `json:"preco_unitario"`
	Data              time.Time `json:"data,omitempty"`
}

type RegisterMovementInput struct {
	AtivoID       string    `json:"ativo_id"`
	Kind          string    `json:"kind"`
	Quantidade    float64   `json:"quantidade,omitempty"`
	PrecoUnitario float64   `json:"preco_unitario,omitempty"`
	ValorProvento float64   `json:"valor_provento,omitempty"`
	Data          time.Time `json:"data,omitempty"`
}

type UpdateQuoteInput struct {
	AtivoID  string    `json:"ativo_id"`
	Cotacao  float64   `json:"cotacao"`
	ObtidaEm time.Time `json:"obtida_em"`
}
