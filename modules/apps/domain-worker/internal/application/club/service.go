package club

import (
	"context"

	domainclub "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/club"
)

// Service is the use case — the only thing that calls domainclub.Repository's
// write methods, so every mutation goes through the aggregate's invariants.
type Service struct {
	repo domainclub.Repository
}

func NewService(repo domainclub.Repository) *Service {
	return &Service{repo: repo}
}

// Upsert writes the club, tolerating a missing nome when the club already
// exists (a search result that omits the name should not blank it). The
// aggregate's New validates club_id.
func (s *Service) Upsert(ctx context.Context, in UpsertInput) (domainclub.Club, domainclub.Event, error) {
	existing, err := s.repo.FindByID(ctx, in.ClubID)
	if err != nil && err != domainclub.ErrNotFound {
		return domainclub.Club{}, nil, err
	}

	var c domainclub.Club
	if err == domainclub.ErrNotFound {
		c, err = domainclub.New(in.ClubID, in.Name, in.Tag)
		if err != nil {
			return domainclub.Club{}, nil, err
		}
	} else {
		c = existing
	}
	c.SetIdentity(in.Name, in.Tag, in.Stadium, in.RegiaoID, in.TimeID, in.EscudoAssetID)
	c.SetKit(in.Color1, in.Color2, in.Color3, in.Color4)
	if in.Tracked {
		c.Tracked = true
	}

	if err := s.repo.Upsert(ctx, c); err != nil {
		return domainclub.Club{}, nil, err
	}
	return c, domainclub.Upserted{
		ClubID: c.ClubID, Name: c.Name, Tag: c.Tag,
		Tracked: c.Tracked, OccurredAt: c.UpdatedAt,
	}, nil
}
