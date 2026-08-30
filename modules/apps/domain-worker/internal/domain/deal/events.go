package deal

import (
	"encoding/json"
	"time"
)

// Event is implemented by every domain event this aggregate raises.
type Event interface {
	EventName() string
}

// Created fires ONLY when the deal's row was genuinely new
// (inserted) — a re-poll that merely refreshes scraped_at/payload on
// an existing row raises nothing, so downstream consumers (the Discord
// announcer) never re-announce the same deal every poll. OccurredAt is
// ScrapedAt, not now: the event should be as old as the poll that
// discovered the deal, which is what keeps the announcer's
// stale-drop honest.
type Created struct {
	Source        string          `json:"source"`
	SourceDealID  string          `json:"source_deal_id"`
	Title         string          `json:"title"`
	URL           string          `json:"url"`
	Store         *string         `json:"store"`
	PriceCents    *int            `json:"price_cents"`
	OldPriceCents *int            `json:"old_price_cents"`
	PostedAt      *time.Time      `json:"posted_at"`
	ScrapedAt     time.Time       `json:"scraped_at"`
	Payload       json.RawMessage `json:"payload,omitempty"`
	OccurredAt    time.Time       `json:"occurred_at"`
}

func (Created) EventName() string { return "deal.created" }

// CreatedFrom projects a Deal into its own creation event.
func CreatedFrom(d Deal) Created {
	return Created{
		Source:        d.Source,
		SourceDealID:  d.SourceDealID,
		Title:         d.Title,
		URL:           d.URL,
		Store:         d.Store,
		PriceCents:    d.PriceCents,
		OldPriceCents: d.OldPriceCents,
		PostedAt:      d.PostedAt,
		ScrapedAt:     d.ScrapedAt,
		Payload:       d.Payload,
		OccurredAt:    d.ScrapedAt,
	}
}
