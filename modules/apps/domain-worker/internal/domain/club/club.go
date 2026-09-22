// Package club is the domain layer for the Club aggregate — a Pro Clubs
// club (EA FC 27) whose public data the hub accumulates. Same shape as
// domain/conta: plain Go types and invariants, no database, no HTTP.
//
// ClubID is TEXT, not UUID: the source sends the id as a string and
// alternates singular/plural parameter names, so normalizing it to text
// here is what the ingest's translation layer feeds. Acompanhado=false is
// the state of any club found by search — we only have its ClubeTotais;
// it turns true once the ingest cycle has fetched squad and matches.
package club

import (
	"errors"
	"time"
)

var (
	ErrClubIDRequired = errors.New("club_id is required")
	ErrNomeRequired   = errors.New("nome is required")
)

type Club struct {
	ClubID   string
	Nome     string
	Sigla    string
	Estadio  string
	RegiaoID string
	TimeID   string
	// EscudoAssetID has no published lookup table on the source side —
	// stored raw; the visual shape is chosen by inference downstream.
	EscudoAssetID string
	// Kit colours arrive as decimal RGB (16777215 = #FFFFFF). Conversion
	// to hex belongs to the presentation layer, so the raw value is kept.
	Cor1, Cor2, Cor3, Cor4 int
	Acompanhado            bool
	AtualizadoEm           time.Time
}

// New constructs a Club. acompanhado always starts false — a club becomes
// followed only when the ingest cycle succeeds at fetching its squad and
// matches, never at discovery time.
func New(clubID, nome, sigla string) (Club, error) {
	if clubID == "" {
		return Club{}, ErrClubIDRequired
	}
	if nome == "" {
		return Club{}, ErrNomeRequired
	}
	return Club{
		ClubID: clubID,
		Nome:   nome,
		Sigla:  sigla,
	}, nil
}

// SetIdentity applies the descriptive fields fetched from the source.
// Empty values mean "leave unchanged", the same convention as
// conta.Edit — the source sometimes omits a field rather than sending an
// empty one.
func (c *Club) SetIdentity(nome, sigla, estadio, regiaoID, timeID, escudoAssetID string) {
	if nome != "" {
		c.Nome = nome
	}
	if sigla != "" {
		c.Sigla = sigla
	}
	if estadio != "" {
		c.Estadio = estadio
	}
	if regiaoID != "" {
		c.RegiaoID = regiaoID
	}
	if timeID != "" {
		c.TimeID = timeID
	}
	if escudoAssetID != "" {
		c.EscudoAssetID = escudoAssetID
	}
}

// SetKit records the four decimal RGB colours. A zero means "the source
// sent nothing", so an all-zero call is a no-op rather than a wipe.
func (c *Club) SetKit(cor1, cor2, cor3, cor4 int) {
	if cor1 == 0 && cor2 == 0 && cor3 == 0 && cor4 == 0 {
		return
	}
	c.Cor1, c.Cor2, c.Cor3, c.Cor4 = cor1, cor2, cor3, cor4
}
