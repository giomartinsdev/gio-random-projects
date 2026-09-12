// Package ativo is the domain layer for the Ativo aggregate as seen
// from domain-api: read-only entity + repository, same split as
// domain/room. Creation and movement registration go through /sync
// (ativo.create, ativo.registerMovement); only the quote update has a
// dedicated async route here (ativo.updateQuote), since it's polled in
// the background by asset-manager-api rather than driven by a person.
package ativo

import "time"

type Ativo struct {
	ID              string
	UsuarioEmail    string
	ContaID         string
	Ticker          string
	Status          string
	QuantidadeAtual float64
	CustoMedio      float64
	UltimaCotacao   float64
	UltimaCotacaoEm time.Time
	CriadoEm        time.Time
	AtualizadoEm    time.Time
}
