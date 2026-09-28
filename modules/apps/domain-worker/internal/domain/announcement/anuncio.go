// Package anuncio is the domain layer for the Announcement aggregate — the
// home feed. An announcement is DERIVED by the ingest from the facts it
// just wrote (a new result, a beaten record, a division change); it is not
// curated by hand and has no public write endpoint.
package anuncio

import (
	"errors"
	"time"
)

const (
	TipoResultado = "resultado"
	TipoRanking   = "ranking"
	TipoJogador   = "jogador"
	TipoNovidade  = "novidade"
)

var (
	ErrTituloRequired = errors.New("title is required")
	ErrTipoInvalido   = errors.New("kind must be \"resultado\", \"ranking\", \"jogador\" or \"novidade\"")
)

type Anuncio struct {
	ID           string
	Kind         string
	Title       string
	Body        string
	ReferenciaID string
	Icon        string
	// Data são os fatos do aviso (resultado, gols, tipo de partida), para a
	// interface montar a frase no idioma escolhido. O Title é o fallback.
	Data        []byte
	GeneratedAt     time.Time
	ExpiresAt     *time.Time
}

func validTipo(t string) bool {
	return t == TipoResultado || t == TipoRanking || t == TipoJogador || t == TipoNovidade
}

// New constructs an Anuncio. An unknown tipo is rejected rather than
// coerced: the feed is generated, so a bad tipo is a bug worth surfacing.
func New(kind, title, body, referenciaID, icon string, data []byte, generatedAt time.Time) (Anuncio, error) {
	if title == "" {
		return Anuncio{}, ErrTituloRequired
	}
	if !validTipo(kind) {
		return Anuncio{}, ErrTipoInvalido
	}
	if len(data) == 0 {
		data = []byte("{}")
	}
	return Anuncio{
		Kind:         kind,
		Title:       title,
		Body:        body,
		ReferenciaID: referenciaID,
		Icon:        icon,
		Data:        data,
		GeneratedAt:     generatedAt.UTC(),
	}, nil
}

// Event is implemented by every domain event this aggregate raises. There
// are none today — the announcement IS the record — but the interface keeps
// the worker's routing switch uniform with every other aggregate.
type Event interface {
	EventName() string
}
