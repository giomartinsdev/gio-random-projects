// Package conta is the domain layer for the Conta aggregate as seen
// from domain-api: read-only, same split as domain/room -- domain-worker
// owns the write side (conta.create / conta.update) via /sync.
package conta

import "time"

type Conta struct {
	ID           string
	UsuarioEmail string
	Nome         string
	Tipo         string
	Status       string
	CriadoEm     time.Time
	AtualizadoEm time.Time
}
