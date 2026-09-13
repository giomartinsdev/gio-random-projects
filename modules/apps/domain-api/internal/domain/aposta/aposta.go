// Package aposta is the domain layer for the Aposta aggregate as seen
// from domain-api: read-only entity + repository, same split as
// domain/ativo. Registrar/resolver both go through /sync
// (aposta.registrar, aposta.resolver) -- there is no dedicated async
// route for this aggregate.
package aposta

import "time"

type Aposta struct {
	ID            string
	UsuarioEmail  string
	ContaID       string
	Descricao     string
	ValorApostado float64
	Odd           float64
	Status        string
	RetornoObtido float64
	DataAposta    time.Time
	DataResultado time.Time
	CriadoEm      time.Time
	AtualizadoEm  time.Time
}
