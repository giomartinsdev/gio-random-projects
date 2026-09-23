// Package ativomovimento is the domain layer for an Ativo's movement
// history (compra/venda/provento) as seen from domain-api: read-only,
// same split as domain/room. Movements are registered via /sync
// (ativo.registerMovement) by the caller directly.
package ativomovimento

import "time"

type AtivoMovimento struct {
	ID                 string
	AtivoID            string
	Kind               string
	Quantidade         float64
	PrecoUnitario      float64
	ValorProvento      float64
	ResultadoRealizado float64
	Data               time.Time
	CreatedAt           time.Time
}
