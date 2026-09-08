// Package cchdeck is the domain layer for the CCH deck marketplace —
// decks forged in cch.giomartins.dev's Forja (with AI or by hand),
// refined, published, then playable in any room like a built-in deck.
// Storage-shaped like cchroom: the bounds that make a deck a deck
// (minimum cards, blank-count rules, field length caps) are enforced in
// cch-api at publish time, so this package only guarantees that what
// reaches Postgres is a complete, attributable record. Upsert semantics
// cover both publishing a new deck and bumping its play count — the
// whole record is the payload and the id is the key, so a re-fired
// command (crashed cutover import, retried queue delivery) lands on
// the same row instead of erroring.
package cchdeck

import (
	"errors"
	"time"
)

// Deck is one marketplace entry, stored as raw card texts — cch-api
// derives card ids at registration time (decks.Register), and the
// game engine never learns this table exists.
type Deck struct {
	ID          string
	Name        string
	Emoji       string
	Description string
	ParentID    string
	Author      string
	Whites      []string
	Blacks      []string
	CreatedAt   time.Time
	Plays       int
}

var (
	ErrIDRequired    = errors.New("cchdeck: id is required")
	ErrNameRequired  = errors.New("cchdeck: name is required")
	ErrCardsRequired = errors.New("cchdeck: whites and blacks are required")
)

// New validates the storage shape every marketplace entry must have —
// id and name because a row without them is unplayable and unlistable,
// non-empty card lists because text[] NOT NULL has no use for nil and
// a deck with no cards starves the game. How MANY cards is the
// caller's publish-time business, not a storage concern.
func New(id, name string, whites, blacks []string) (Deck, error) {
	if id == "" {
		return Deck{}, ErrIDRequired
	}
	if name == "" {
		return Deck{}, ErrNameRequired
	}
	if len(whites) == 0 || len(blacks) == 0 {
		return Deck{}, ErrCardsRequired
	}
	return Deck{ID: id, Name: name, Whites: whites, Blacks: blacks}, nil
}

// Event is what a successful cchdeck command raises. Like cchroom's,
// nobody announces these today — they exist for the audit row and for
// whatever subscriber comes next.
type Event interface{ EventName() string }

type Upserted struct {
	DeckID     string    `json:"deck_id"`
	Name       string    `json:"name"`
	Plays      int       `json:"plays"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Upserted) EventName() string { return "cchdeck.upserted" }

// Played is the fire-and-forget play count bump (cchdeck.play). It
// carries no count — the increment happened inside the UPDATE — just
// the fact that a game started with this deck.
type Played struct {
	DeckID     string    `json:"deck_id"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Played) EventName() string { return "cchdeck.played" }