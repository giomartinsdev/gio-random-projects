// Package deal is the domain layer for the Deal aggregate — the
// stage-row every scraper feed eventually becomes. Plain Go types and
// business rules, no database, no HTTP, no Redis. domain-api has its
// own smaller copy of this package (read-only: it never writes rows,
// it only shapes the command and serves reads back out).
//
// Identity is deliberately the source's own (source, source_deal_id)
// — this aggregate never mints IDs of its own, because the same deal
// re-polled tomorrow must land on yesterday's row, not a fresh one.
package deal

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var (
	ErrSourceRequired       = errors.New("source is required")
	ErrSourceDealIDRequired = errors.New("source_deal_id is required")
	ErrTitleRequired        = errors.New("title is required")
	ErrURLRequired          = errors.New("url is required")
)

// Deal is one scraped offer. Store, the price pair and PostedAt mirror
// what the source actually showed us (all optional), payload keeps the
// source's own JSON verbatim so new fields never need a re-scrape.
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
	// RawMessage, not []byte: a []byte serializes as base64, and this
	// field is verbatim JSON everywhere it travels (into the jsonb
	// column, into deal.created's payload) — base64 there would push
	// decoding onto every consumer.
	Payload json.RawMessage
}

// Validate enforces what the source side of the pipeline must always
// provide. The payload is not required — an empty JSON object is as
// verbatim as a missing one.
func (d Deal) Validate() error {
	if d.Source == "" {
		return ErrSourceRequired
	}
	if d.SourceDealID == "" {
		return ErrSourceDealIDRequired
	}
	if d.Title == "" {
		return ErrTitleRequired
	}
	if d.URL == "" {
		return ErrURLRequired
	}
	return nil
}

// Normalize fills in the two defaults the source side may leave blank,
// in place: a missing scraped_at means "now' (the poll itself is the
// scrape), and a missing payload still has to satisfy the column's NOT
// NULL — stored as an empty JSON object, not the empty string.
func (d *Deal) Normalize(now time.Time) {
	if d.ScrapedAt.IsZero() {
		d.ScrapedAt = now
	}
	if len(d.Payload) == 0 {
		d.Payload = json.RawMessage("{}")
	}
}

// EntityID is the audit_log's entity_id — the same "source:source_deal_id"
// string the python scrape pipeline used before this aggregate existed.
func (d Deal) EntityID() string {
	return fmt.Sprintf("%s:%s", d.Source, d.SourceDealID)
}
