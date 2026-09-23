// Package partida is the domain layer for the Partida aggregate — one
// match, seen from one side. The same match_id is written twice (once per
// club) but the repository upserts by MatchID, so the second write is an
// update, not a second row: that is what guarantees a match played between
// two followed clubs exists exactly once.
//
// ResultadoCasa is stored already normalized (vitoria/empate/derrota) —
// it is NEVER computed at read time, because the source uses five
// different numeric codes for three outcomes and sends no marker at all
// for friendlies.
package partida

import (
	"errors"
	"time"
)

const (
	TipoLiga     = "liga"
	TipoAmistoso = "amistoso"
	TipoPlayoff  = "playoff"

	ResultadoVitoria = "vitoria"
	ResultadoEmpate  = "empate"
	ResultadoDerrota = "derrota"
)

var (
	ErrMatchIDRequired = errors.New("match_id is required")
	ErrClubesRequired  = errors.New("home_club_id and away_club_id are required")
	ErrTipoInvalido    = errors.New("kind must be \"liga\", \"amistoso\" or \"playoff\"")
	ErrResultadoInvalido = errors.New("resultado must be \"vitoria\", \"empate\" or \"derrota\"")
)

type Partida struct {
	ID            string
	MatchID       string
	Timestamp     time.Time
	Kind          string
	PlayoffRound string
	ClubeCasaID   string
	ClubeForaID   string
	HomeGoals      int
	AwayGoals      int
	DecidedByForfeit          bool
	VencedorPorDesistenciaID  string
	HomeResult string
	// Lances is the match timeline, correlated from the source's
	// undocumented event aggregates. Stored as raw JSON because its shape
	// is inferred, not specified.
	Events  []byte
	CreatedAt time.Time
}

func validTipo(t string) bool {
	return t == TipoLiga || t == TipoAmistoso || t == TipoPlayoff
}

func validResultado(r string) bool {
	return r == ResultadoVitoria || r == ResultadoEmpate || r == ResultadoDerrota
}

// New constructs a Partida, validating the two normalized enums. Everything
// else is passed through — the normalizer has already translated the
// source's codes.
func New(matchID, clubeCasaID, clubeForaID, kind, homeResult string, ts time.Time) (Partida, error) {
	if matchID == "" {
		return Partida{}, ErrMatchIDRequired
	}
	if clubeCasaID == "" || clubeForaID == "" {
		return Partida{}, ErrClubesRequired
	}
	if !validTipo(kind) {
		return Partida{}, ErrTipoInvalido
	}
	if !validResultado(homeResult) {
		return Partida{}, ErrResultadoInvalido
	}
	return Partida{
		MatchID:       matchID,
		ClubeCasaID:   clubeCasaID,
		ClubeForaID:   clubeForaID,
		Kind:          kind,
		HomeResult: homeResult,
		Timestamp:     ts,
	}, nil
}

// ResultadoFora is the mirror of ResultadoCasa — derived, never stored
// twice, so the two can never disagree.
func (p Partida) ResultadoFora() string {
	switch p.HomeResult {
	case ResultadoVitoria:
		return ResultadoDerrota
	case ResultadoDerrota:
		return ResultadoVitoria
	default:
		return ResultadoEmpate
	}
}
