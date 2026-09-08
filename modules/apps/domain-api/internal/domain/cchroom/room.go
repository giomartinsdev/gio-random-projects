// Package cchroom is the domain layer for the CCH room registry entry
// as seen from domain-api: just enough to read, since this binary
// never writes CCH data — the writes go through the command pipeline
// to domain-worker (see that module's domain/cchroom for the
// authoritative copy, including why the aggregate is storage-shaped).
package cchroom

import "time"

// Room is one registry entry of cch.giomartins.dev's party game: its
// code, when it was created, the scrypt salt+hash of its password and
// the HMAC key that keeps resume tokens verifiable across a restart.
// Salt/Hash/ResumeKey are opaque bytes here, exactly as the caller
// generated them.
type Room struct {
	ID        string
	CreatedAt time.Time
	Salt      []byte
	Hash      []byte
	ResumeKey []byte
}