package cchdeck

import (
	"context"
	"time"

	domaincchdeck "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchdeck"
)

// Service is the use case: the only thing that calls
// domaincchdeck.Repository's write methods.
type Service struct {
	repo domaincchdeck.Repository
}

func NewService(repo domaincchdeck.Repository) *Service {
	return &Service{repo: repo}
}

// Upsert writes the deck whole. A zero created_at means "now" — the
// caller always sends the deck's original forge timestamp, but a
// hand-rolled command shouldn't mint one from year zero.
func (s *Service) Upsert(ctx context.Context, in UpsertInput) (domaincchdeck.Event, error) {
	createdAt := in.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	d := domaincchdeck.Deck{
		ID:          in.ID,
		Name:        in.Name,
		Emoji:       in.Emoji,
		Description: in.Description,
		ParentID:    in.ParentID,
		Author:      in.Author,
		Whites:      in.Whites,
		Blacks:      in.Blacks,
		CreatedAt:   createdAt,
		Plays:       in.Plays,
	}
	if _, err := domaincchdeck.New(d.ID, d.Name, d.Whites, d.Blacks); err != nil {
		return nil, err
	}
	if err := s.repo.Upsert(ctx, d); err != nil {
		return nil, err
	}
	return domaincchdeck.Upserted{DeckID: d.ID, Name: d.Name, Plays: d.Plays, OccurredAt: time.Now().UTC()}, nil
}
// Play counts a game started with the deck. There is no existence
// check here beyond the UPDATE matching a row — a bump for a deck that
// isn't there fails the command (and lands in the audit log as such),
// which is the right amount of ceremony for a cosmetic counter.
func (s *Service) Play(ctx context.Context, in PlayInput) (domaincchdeck.Event, error) {
	if in.ID == "" {
		return nil, domaincchdeck.ErrIDRequired
	}
	if _, err := s.repo.IncrementPlays(ctx, in.ID); err != nil {
		return nil, err
	}
	return domaincchdeck.Played{DeckID: in.ID, OccurredAt: time.Now().UTC()}, nil
}
