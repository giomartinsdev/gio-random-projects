// Package deal is domain-api's read-side view of the Deal aggregate —
// domain-worker has the full copy (its writes enforce Validate/
// Normalize there; this side only ever reads rows those writes made).
package deal

import "time"

// Deal is one scraped offer. Identity is the source's own
// (source, source_deal_id) — this aggregate never mints IDs of its
// own, see domain-worker's copy for the full story.
type Deal struct {
	Source        string
	SourceDealID  string
	Title         string
	URL           string
	Store         *string
	PriceCents    *int
	OldPriceCents *int
	PostedAt      *time.Time
	ScrapedAt     time.Time
	Payload       []byte
}