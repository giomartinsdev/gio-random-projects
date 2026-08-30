// Package deal holds the concrete application.Command payload for the
// Deal aggregate — domain-worker decodes the same shape on the other
// end (its own, identical copy of this package). Deliberately
// duplicated rather than shared: the two Go modules are independent on
// purpose (same reasoning as every other aggregate's commands.go).
package deal

import (
	"encoding/json"
	"time"
)

// UpsertInput is the only write this aggregate takes: the scrapers
// push the same deal every poll, and the worker decides insert vs
// update from the row store, not from the caller.
type UpsertInput struct {
	Source        string          `json:"source"`
	SourceDealID  string          `json:"source_deal_id"`
	Title         string          `json:"title"`
	URL           string          `json:"url"`
	Store         *string         `json:"store"`
	PriceCents    *int            `json:"price_cents"`
	OldPriceCents *int            `json:"old_price_cents"`
	PostedAt      *time.Time      `json:"posted_at"`
	ScrapedAt     *time.Time      `json:"scraped_at"`
	Payload       json.RawMessage `json:"payload,omitempty"`
}