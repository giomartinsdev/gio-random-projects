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
	OrigemProprio        = "own"
	OrigemRival          = "rival"
	OrigemRivalDeRival   = "rival_of_rival"
	OrigemManual         = "manual"
)

var (
	ErrUsuarioRequired = errors.New("user_email is required")
	ErrClubRequired    = errors.New("club_id is required")
	ErrOrigemInvalida  = errors.New("source must be \"own\", \"rival\", \"rival_of_rival\" or \"manual\"")
)

// WatchEntry is one club a person follows, plus where the sync found it.
type WatchEntry struct {
	UserEmail  string
	ClubID        string
	TrackedSince time.Time
	Source        string
}

func validOrigem(o string) bool {
	return o == OrigemProprio || o == OrigemRival || o == OrigemRivalDeRival || o == OrigemManual
}

// NewWatch constructs a follow entry. An unknown origem falls back to
// "manual" rather than failing: the sync's three levels are a
// presentation concern, and losing a follow because the level was
// mislabelled would be worse than mislabelling it.
func NewWatch(userEmail, clubID, source string) (WatchEntry, error) {
	if userEmail == "" {
		return WatchEntry{}, ErrUsuarioRequired
	}
	if clubID == "" {
		return WatchEntry{}, ErrClubRequired
	}
	if !validOrigem(source) {
		source = OrigemManual
	}
	return WatchEntry{
		UserEmail:  userEmail,
		ClubID:        clubID,
		TrackedSince: time.Now().UTC(),
		Source:        source,
	}, nil
}

// Notificacoes is one person's notification toggles. Canal == "" means
// notifications are off — the hub works normally without it.
type Notificacoes struct {
	UserEmail       string
	Channel              string
	WeeklyDigest    bool
	RecordsAndDivisions  bool
	MatchResults  bool
	UpdatedAt       time.Time
}

// DefaultNotificacoes is what a person gets the first time they open the
// notifications screen: everything on, but no channel yet, so nothing is
// sent until they configure one.
func DefaultNotificacoes(userEmail string) Notificacoes {
	return Notificacoes{
		UserEmail:      userEmail,
		WeeklyDigest:   true,
		RecordsAndDivisions: true,
		MatchResults: true,
		UpdatedAt:      time.Now().UTC(),
	}
}

// ProReivindicado is the pro a person claims. One per person: the key is
// the e-mail, not the player.
type ProReivindicado struct {
	UserEmail   string
	ClubID         string
	PlayerID       string
	Verified     bool
	ClaimedAt time.Time
}

// SyncRun is the progress of one person's background sync, read by the
// SPA to draw the three-level indicator without blocking navigation.
type SyncRun struct {
	UserEmail string
	Running      bool
	SkillRating        int
	Total        int
	Completed   int
	Current        string
	NewItems        []string
	StartedAt   time.Time
	FinishedAt  time.Time
}
