// Package conta is the domain layer for the Conta aggregate as seen
// from domain-api: read-only, same split as domain/room -- domain-worker
// owns the write side (conta.create / conta.update) via /sync.
package conta

import "time"

type Conta struct {
	ID           string
	UserEmail string
	Name         string
	Kind         string
	Status       string
	CreatedAt     time.Time
	UpdatedAt time.Time
}
