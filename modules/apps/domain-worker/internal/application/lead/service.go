package lead

import (
	"context"

	domainlead "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/lead"
)

type Service struct {
	repo domainlead.Repository
}

func NewService(repo domainlead.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Capture(ctx context.Context, id string, in CaptureInput) (domainlead.Lead, domainlead.Event, error) {
	l, err := domainlead.New(id, in.Email)
	if err != nil {
		return domainlead.Lead{}, nil, err
	}
	if err := s.repo.Insert(ctx, l); err != nil {
		return domainlead.Lead{}, nil, err
	}
	return l, domainlead.Captured{LeadID: l.ID, Email: l.Email, OccurredAt: l.CreatedAt}, nil
}
