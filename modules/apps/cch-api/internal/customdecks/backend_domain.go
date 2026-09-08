package customdecks

import (
	"context"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/domainapi"
)

// DomainBackend keeps the marketplace in domain-api's cch_custom_decks
// table (written by domain-worker through the command pipeline).
// Publish's Save is a synchronous round-trip through POST /sync — "the
// deck exists" must mean "the row is in Postgres", or a restart right
// after publishing would silently eat it. The play count goes the
// normal async way.
type DomainBackend struct {
	c *domainapi.Client
}

// NewDomainBackend wires the marketplace to domain-api.
func NewDomainBackend(c *domainapi.Client) *DomainBackend {
	return &DomainBackend{c: c}
}

func (b *DomainBackend) Load(ctx context.Context) ([]Deck, error) {
	decks, err := b.c.ListDecks(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Deck, 0, len(decks))
	for _, d := range decks {
		out = append(out, Deck{
			ID:          d.ID,
			Name:        d.Name,
			Emoji:       d.Emoji,
			Description: d.Description,
			ParentID:    d.ParentID,
			Author:      d.Author,
			Whites:      d.Whites,
			Blacks:      d.Blacks,
			CreatedAt:   d.CreatedAt,
			Plays:       d.Plays,
		})
	}
	return out, nil
}

func (b *DomainBackend) Save(ctx context.Context, deck Deck) error {
	if _, err := b.c.Sync(ctx, "cchdeck.upsert", domainapi.DeckUpsert{
		ID:          deck.ID,
		Name:        deck.Name,
		Emoji:       deck.Emoji,
		Description: deck.Description,
		ParentID:    deck.ParentID,
		Author:      deck.Author,
		Whites:      deck.Whites,
		Blacks:      deck.Blacks,
		CreatedAt:   deck.CreatedAt,
		Plays:       deck.Plays,
	}); err != nil {
		return fmt.Errorf("persist deck %s: %w", deck.ID, err)
	}
	return nil
}

func (b *DomainBackend) PlayCounted(ctx context.Context, id string) error {
	return b.c.PlayCounted(ctx, id)
}