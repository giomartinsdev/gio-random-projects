// Package cchdeck holds the concrete application.Command payloads for
// the CCH deck marketplace — domain-api decodes the same shapes on the
// other end (its own copy of this package, used only to build outgoing
// commands, never to decode).
package cchdeck

import "time"

// UpsertInput is one whole marketplace record — publish and the plays
// bump are both "write this deck". cch-api minted the id ("cx" + hex)
// and validated every bound before sending, so nothing here is
// server-generated; the fields mirror its own persisted JSON shape.
type UpsertInput struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Emoji       string    `json:"emoji,omitempty"`
	Description string    `json:"description,omitempty"`
	ParentID    string    `json:"parent_id,omitempty"`
	Author      string    `json:"author,omitempty"`
	Whites      []string  `json:"whites"`
	Blacks      []string  `json:"blacks"`
	CreatedAt   time.Time `json:"created_at,omitempty"`
	Plays       int       `json:"plays"`
}
// PlayInput is the play-count bump's whole payload: just the deck id —
// the increment itself happens in the storage layer (plays = plays + 1)
// so concurrent bumps can't overwrite each other.
type PlayInput struct {
	ID string `json:"id"`
}
