// Package preferencia is the domain layer for everything that belongs to
// ONE person rather than to the public dataset: the clubs they follow,
// the pro they claimed, and which notifications they want.
//
// This is the only part of the clubs schema partitioned by usuario_email.
// Every read must filter by it — that is the mechanism guaranteeing one
// person's watchlist and claimed pro never show up for another.
package preferencia

import (
	"errors"
	"time"
)

const (
	OrigemProprio        = "proprio"
	OrigemRival          = "rival"
	OrigemRivalDeRival   = "rival_de_rival"
	OrigemManual         = "manual"
)

var (
	ErrUsuarioRequired = errors.New("usuario_email is required")
	ErrClubRequired    = errors.New("club_id is required")
	ErrOrigemInvalida  = errors.New("origem must be \"proprio\", \"rival\", \"rival_de_rival\" or \"manual\"")
)

// WatchEntry is one club a person follows, plus where the sync found it.
type WatchEntry struct {
	UsuarioEmail  string
	ClubID        string
	SeguindoDesde time.Time
	Origem        string
}

func validOrigem(o string) bool {
	return o == OrigemProprio || o == OrigemRival || o == OrigemRivalDeRival || o == OrigemManual
}

// NewWatch constructs a follow entry. An unknown origem falls back to
// "manual" rather than failing: the sync's three levels are a
// presentation concern, and losing a follow because the level was
// mislabelled would be worse than mislabelling it.
func NewWatch(usuarioEmail, clubID, origem string) (WatchEntry, error) {
	if usuarioEmail == "" {
		return WatchEntry{}, ErrUsuarioRequired
	}
	if clubID == "" {
		return WatchEntry{}, ErrClubRequired
	}
	if !validOrigem(origem) {
		origem = OrigemManual
	}
	return WatchEntry{
		UsuarioEmail:  usuarioEmail,
		ClubID:        clubID,
		SeguindoDesde: time.Now().UTC(),
		Origem:        origem,
	}, nil
}

// Notificacoes is one person's notification toggles. Canal == "" means
// notifications are off — the hub works normally without it.
type Notificacoes struct {
	UsuarioEmail       string
	Canal              string
	ResumoPeriodico    bool
	RecordesEDivisoes  bool
	ResultadoPartidas  bool
	AtualizadoEm       time.Time
}

// DefaultNotificacoes is what a person gets the first time they open the
// notifications screen: everything on, but no channel yet, so nothing is
// sent until they configure one.
func DefaultNotificacoes(usuarioEmail string) Notificacoes {
	return Notificacoes{
		UsuarioEmail:      usuarioEmail,
		ResumoPeriodico:   true,
		RecordesEDivisoes: true,
		ResultadoPartidas: true,
		AtualizadoEm:      time.Now().UTC(),
	}
}

// ProReivindicado is the pro a person claims. One per person: the key is
// the e-mail, not the player.
type ProReivindicado struct {
	UsuarioEmail   string
	ClubID         string
	PlayerID       string
	Verificado     bool
	ReivindicadoEm time.Time
}

// SyncRun is the progress of one person's background sync, read by the
// SPA to draw the three-level indicator without blocking navigation.
type SyncRun struct {
	UsuarioEmail string
	Rodando      bool
	Nivel        int
	Total        int
	Concluidos   int
	Atual        string
	Novos        []string
	IniciadoEm   time.Time
	ConcluidoEm  time.Time
}
