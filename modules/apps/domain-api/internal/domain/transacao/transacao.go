// Package transacao is the domain layer for the Transacao aggregate as
// seen from domain-api: read-only entity + repository, same split as
// domain/room. Writes are published as application.Command by this
// binary's http layer and applied by domain-worker.
package transacao

import "time"

type Transacao struct {
	ID           string
	UsuarioEmail string
	ContaID      string
	Tipo         string
	Categoria    string
	Descricao    string
	AnexoImagem  string
	Valor        float64
	Data         time.Time
	CriadoEm     time.Time
	AtualizadoEm time.Time
}
