package deal

import (
	"errors"
	"testing"
	"time"
)

func baseDeal() Deal {
	return Deal{
		Source:       "pld",
		SourceDealID: "42",
		Title:        "SSD 1TB",
		URL:          "https://example.com/ssd",
	}
}

func TestValidateRequiresIdentityAndContent(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*Deal)
		want error
	}{
		{"missing source", func(d *Deal) { d.Source = "" }, ErrSourceRequired},
		{"missing source_deal_id", func(d *Deal) { d.SourceDealID = "" }, ErrSourceDealIDRequired},
		{"missing title", func(d *Deal) { d.Title = "" }, ErrTitleRequired},
		{"missing url", func(d *Deal) { d.URL = "" }, ErrURLRequired},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			d := baseDeal()
			tt.mut(&d)
			if err := d.Validate(); !errors.Is(err, tt.want) {
				t.Fatalf("Validate() = %v, want %v", err, tt.want)
			}
		})
	}

	t.Run("a complete deal passes", func(t *testing.T) {
		if err := baseDeal().Validate(); err != nil {
			t.Fatalf("Validate() = %v, want nil", err)
		}
	})
}

func TestNormalizeFillsScrapedAtAndPayload(t *testing.T) {
	now := time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)
	d := baseDeal()
	d.Normalize(now)

	if !d.ScrapedAt.Equal(now) {
		t.Fatalf("ScrapedAt = %v, want %v", d.ScrapedAt, now)
	}
	if string(d.Payload) != "{}" {
		t.Fatalf("Payload = %q, want {}", d.Payload)
	}
}

func TestNormalizeKeepsProvidedValues(t *testing.T) {
	scraped := time.Date(2026, 8, 29, 0, 0, 0, 0, time.UTC)
	d := baseDeal()
	d.ScrapedAt = scraped
	d.Payload = []byte(`{"a":1}`)
	d.Normalize(scraped.Add(time.Hour))

	if !d.ScrapedAt.Equal(scraped) {
		t.Fatalf("ScrapedAt = %v, want %v", d.ScrapedAt, scraped)
	}
	if string(d.Payload) != `{"a":1}` {
		t.Fatalf("Payload overwritten: %q", d.Payload)
	}
}

func TestEntityID(t *testing.T) {
	if got := baseDeal().EntityID(); got != "pld:42" {
		t.Fatalf("EntityID() = %q, want %q", got, "pld:42")
	}
}

func TestCreatedEventFromDeal(t *testing.T) {
	posted := time.Date(2026, 8, 28, 9, 0, 0, 0, time.UTC)
	d := baseDeal()
	d.ScrapedAt = posted
	d.PriceCents = ptr(8822)

	evt := CreatedFrom(d)
	if evt.EventName() != "deal.created" {
		t.Fatalf("EventName() = %q", evt.EventName())
	}
	if evt.OccurredAt != posted {
		t.Fatalf("OccurredAt = %v, want scraped_at %v", evt.OccurredAt, posted)
	}
	if evt.PriceCents == nil || *evt.PriceCents != 8822 {
		t.Fatalf("PriceCents = %v, want 8822", evt.PriceCents)
	}
}

func ptr(i int) *int { return &i }
