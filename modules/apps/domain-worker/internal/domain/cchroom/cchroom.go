// Package cchroom is the domain layer for the CCH room registry entry —
// the persistent half of a cch.giomartins.dev party-game room: its code,
// when it was created, the scrypt salt+hash of its password, and the
// HMAC key that keeps resume tokens verifiable across a restart. It is
// storage-shaped on purpose: the game's real invariants (what makes a
// password, who may join, what a round is) live entirely in cch-api's
// internal/rooms — this package exists so the registry outlives the
// container, not to learn what a party game is. There is no
// read-modify-write lifecycle either: entries are written whole
// (upsert, so a crashed cutover import can re-fire over its own
// half-done work) and deleted whole (idempotent — the janitor's sweep
// and an adm delete racing each other must both succeed).
package cchroom

import (
	"errors"
	"time"
)

// Room is one registry entry. Salt/Hash/ResumeKey are opaque bytes
// here — cch-api generated them (16 random salt bytes, the scrypt hash
// of the room password, a 32-byte HMAC signing key) and only it knows
// how to use them.
type Room struct {
	ID        string
	CreatedAt time.Time
	Salt      []byte
	Hash      []byte
	ResumeKey []byte
}

var (
	ErrIDRequired     = errors.New("cchroom: id is required")
	ErrSaltRequired   = errors.New("cchroom: salt is required")
	ErrHashRequired   = errors.New("cchroom: hash is required")
	ErrResumeRequired = errors.New("cchroom: resume key is required")
)

// New validates the storage shape every registry entry must have. The
// bytes are not interpreted — only their presence is checked, because
// a row missing any of them would look like a room that accepts every
// password and honors every resume token, which is worse than no row.
func New(id string, createdAt time.Time, salt, hash, resumeKey []byte) (Room, error) {
	if id == "" {
		return Room{}, ErrIDRequired
	}
	if len(salt) == 0 {
		return Room{}, ErrSaltRequired
	}
	if len(hash) == 0 {
		return Room{}, ErrHashRequired
	}
	if len(resumeKey) == 0 {
		return Room{}, ErrResumeRequired
	}
	return Room{ID: id, CreatedAt: createdAt, Salt: salt, Hash: hash, ResumeKey: resumeKey}, nil
}

// Event is what a successful cchroom command raises. Nobody announces
// these today (events-announcer only renders deals) — they exist so the
// audit row can name the affected room and so a future subscriber
// doesn't need cch-api to learn about registry changes.
type Event interface{ EventName() string }

type Created struct {
	RoomID     string    `json:"room_id"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "cchroom.created" }

type Deleted struct {
	RoomID     string    `json:"room_id"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Deleted) EventName() string { return "cchroom.deleted" }