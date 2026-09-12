// Package ativo holds the concrete application.Command payload for the
// Ativo aggregate's dedicated async route (quote updates) --
// domain-worker decodes the same shape on the other end. create/
// registerMovement payloads aren't declared here since domain-api never
// builds them -- callers use /sync directly with the actions in
// application.command.go.
package ativo

import "time"

type UpdateQuoteInput struct {
	AtivoID  string    `json:"ativo_id"`
	Cotacao  float64   `json:"cotacao"`
	ObtidaEm time.Time `json:"obtida_em"`
}
