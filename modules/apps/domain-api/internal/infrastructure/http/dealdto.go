package httpapi

import (
	"encoding/json"
	"time"

	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/deal"
)

// DealResponse is the wire shape for a Deal — kept separate from
// domain/deal.Deal on purpose, same reasoning as PostResponse. The
// optional fields are pointers WITHOUT omitempty on purpose: a deal
// with no known price must render `"price_cents": null`, not vanish
// from the object — callers keying on the field's presence would
// otherwise see a different shape per row.
type DealResponse struct {
	Source        string          `json:"source"`
	SourceDealID  string          `json:"source_deal_id"`
	Title         string          `json:"title"`
	URL           string          `json:"url"`
	Store         *string         `json:"store"`
	PriceCents    *int            `json:"price_cents"`
	OldPriceCents *int            `json:"old_price_cents"`
	PostedAt      *time.Time      `json:"posted_at"`
	ScrapedAt     time.Time       `json:"scraped_at"`
	Payload       json.RawMessage `json:"payload"`
}

func toDealResponse(d domaindeal.Deal) DealResponse {
	return DealResponse{
		Source: d.Source, SourceDealID: d.SourceDealID, Title: d.Title, URL: d.URL,
		Store: d.Store, PriceCents: d.PriceCents, OldPriceCents: d.OldPriceCents,
		PostedAt: d.PostedAt, ScrapedAt: d.ScrapedAt, Payload: d.Payload,
	}
}

func toDealResponses(deals []domaindeal.Deal) []DealResponse {
	out := make([]DealResponse, len(deals))
	for i, d := range deals {
		out[i] = toDealResponse(d)
	}
	return out
}
