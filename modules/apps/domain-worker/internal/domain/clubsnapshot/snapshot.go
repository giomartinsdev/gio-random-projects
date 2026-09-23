// Package clubesnapshot is the domain layer for the Snapshot aggregate —
// one reading of a club's level and division at an instant.
//
// This is the ONLY reason the product can show history: the source keeps
// no past, so every "how has this club evolved" answer is a series of
// these. The repository is append-only by design — a snapshot is never
// updated, and a new reading is diffed against the previous one to raise
// a MudancaDivisao.
package clubesnapshot

import (
	"errors"
	"time"
)

const (
	TipoPromocao    = "promotion"
	TipoRebaixamento = "relegation"
)

var ErrClubIDRequired = errors.New("club_id is required")

type Snapshot struct {
	ID           string
	ClubID       string
	ReadAt       time.Time
	SkillRating        int
	DivisionAtRead      int
	Played        int
	Wins     int
	Draws      int
	Losses     int
	Goals         int
	GoalsConceded int
	// TamanhoElenco lets a squad change (a signing or a departure) be
	// detected by diffing two snapshots, without storing the roster twice.
	SquadSize int
}

// New constructs a Snapshot.
func New(clubID string, readAt time.Time) (Snapshot, error) {
	if clubID == "" {
		return Snapshot{}, ErrClubIDRequired
	}
	return Snapshot{ClubID: clubID, ReadAt: readAt.UTC()}, nil
}

// MudancaDivisao is the event derived from diffing two consecutive
// snapshots. Para < De means a promotion, because 1 is the top division.
type MudancaDivisao struct {
	ID           string
	ClubID       string
	DetectedAt  time.Time
	PreviousDivision           int
	NewDivision         int
	Kind         string
}

// Diff returns the division change between a previous and the current
// reading, or nil when the division did not move. A previous reading with
// Divisao == 0 is treated as "no prior data" rather than a change from
// division zero.
func Diff(prev, cur Snapshot) *MudancaDivisao {
	if prev.DivisionAtRead == 0 || cur.DivisionAtRead == 0 || prev.DivisionAtRead == cur.DivisionAtRead {
		return nil
	}
	kind := TipoRebaixamento
	if cur.DivisionAtRead < prev.DivisionAtRead {
		kind = TipoPromocao
	}
	return &MudancaDivisao{
		ClubID:      cur.ClubID,
		DetectedAt: cur.ReadAt,
		PreviousDivision:          prev.DivisionAtRead,
		NewDivision:        cur.DivisionAtRead,
		Kind:        kind,
	}
}

// Event is implemented by every domain event this aggregate raises. There
// are none today — a snapshot append records its own division change in the
// same transaction, and the API reads it back from the table — but the
// interface exists so the worker's routing switch stays uniform with every
// other aggregate.
type Event interface {
	EventName() string
}
