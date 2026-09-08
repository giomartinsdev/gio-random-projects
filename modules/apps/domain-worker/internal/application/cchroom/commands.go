// Package cchroom holds the concrete application.Command payloads for
// the CCH room registry — domain-api decodes the same shapes on the
// other end (its own copy of this package, used only to build outgoing
// commands, never to decode).
package cchroom

import "time"

// CreateInput is one whole registry entry — cch-api mints the room
// code, salt and hash itself, so unlike room.create there is no
// server-generated id here. []byte fields ride JSON as base64, which
// is what the caller's own JSON-file format already stored.
type CreateInput struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	Salt      []byte    `json:"salt"`
	Hash      []byte    `json:"hash"`
	ResumeKey []byte    `json:"resume_key"`
}

// DeleteInput needs no password: cch-api already checked it before
// deciding the room should go (both for an adm delete and for the
// janitor's sweep) — re-checking here would mean teaching this
// aggregate what a password is, which it refuses to be.
type DeleteInput struct {
	ID string `json:"id"`
}