// Package cchdeck is the domain layer for the CCH deck marketplace as
// seen from domain-api: just enough to read, since this binary never
// writes CCH data — see domain-worker's domain/cchdeck for the
// authoritative copy.
package cchdeck

import "time"

// Deck is one marketplace entry of cch.giomartins.dev's Forja, stored
// as raw card texts — cch-api derives card ids at registration time,
// and the game engine never learns this table exists. The cards ride
// along on purpose: this read path is server-to-server (cch-api's boot
// load), not the browser-facing marketplace listing, which stays
// spoiler-free by serving metadata only.
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