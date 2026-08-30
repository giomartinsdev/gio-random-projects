package deal

import (
	"context"
	"time"

	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/deal"
)

// Service is the use case: the only thing that calls
// domaindeal.Repository.Upsert, so every write goes through the
// aggregate's own invariants (Validate/Normalize) on the way — same
// shape as application/post.Service.
type Service struct {
	repo domaindeal.Repository
}

func NewService(repo domaindeal.Repository) *Service {
	return &Service{repo: repo}
}

// Upsert persists the deal and returns it together with the event it
// raised. A genuinely new row raises deal.created; an update raises
// NOTHING — scrapers re-poll the same feeds on a schedule, and an
// event per re-poll would flood every consumer with copies of deals
// they already saw. The Deal still comes back either way so the
// process loop can stamp the audit row with the entity it touched.
func (s *Service) Upsert(ctx context.Context, in UpsertInput) (domaindeal.Deal, domaindeal.Event, error) {
	d := domaindeal.Deal{
		Source:        in.Source,
		SourceDealID:  in.SourceDealID,
		Title:         in.Title,
		URL:           in.URL,
		Store:         in.Store,
		PriceCents:    in.PriceCents,
		OldPriceCents: in.OldPriceCents,
		PostedAt:      in.PostedAt,
		ScrapedAt:     value(in.ScrapedAt),
		Payload:       in.Payload,
	}
	if err := d.Validate(); err != nil {
		return domaindeal.Deal{}, nil, err
	}
	d.Normalize(time.Now().UTC())

	inserted, err := s.repo.Upsert(ctx, d)
	if err != nil {
		return domaindeal.Deal{}, nil, err
	}
	if !inserted {
		return d, nil, nil
	}
	return d, domaindeal.CreatedFrom(d), nil
}

func value(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}
