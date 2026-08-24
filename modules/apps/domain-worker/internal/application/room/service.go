package room

import (
	"context"
	"time"

	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/room"
)

// Service is the use case: the only thing that calls
// domainroom.Repository's write methods, so every mutation goes
// through the aggregate's own invariants (New/Edit) -- same shape as
// application/post.Service.
type Service struct {
	repo domainroom.Repository
}

func NewService(repo domainroom.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, id string, in CreateInput) (domainroom.Room, domainroom.Event, error) {
	r, err := domainroom.New(id, in.HostID, in.Title, in.DocumentID)
	if err != nil {
		return domainroom.Room{}, nil, err
	}
	if err := s.repo.Insert(ctx, r); err != nil {
		return domainroom.Room{}, nil, err
	}
	return r, domainroom.Created{RoomID: r.ID, HostID: r.HostID, Title: r.Title, OccurredAt: r.CreatedAt}, nil
}

func (s *Service) Update(ctx context.Context, in UpdateInput) (domainroom.Room, domainroom.Event, error) {
	r, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return domainroom.Room{}, nil, err
	}
	if err := r.Edit(in.HostID, in.Title, in.CurrentPage); err != nil {
		return domainroom.Room{}, nil, err
	}
	if err := s.repo.Update(ctx, r); err != nil {
		return domainroom.Room{}, nil, err
	}
	return r, domainroom.Updated{RoomID: r.ID, HostID: r.HostID, Title: r.Title, CurrentPage: r.CurrentPage, OccurredAt: r.UpdatedAt}, nil
}

func (s *Service) Delete(ctx context.Context, in DeleteInput) (domainroom.Event, error) {
	r, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if in.HostID != r.HostID {
		return nil, domainroom.ErrForbidden
	}
	if err := s.repo.Delete(ctx, in.ID); err != nil {
		return nil, err
	}
	return domainroom.Deleted{RoomID: in.ID, OccurredAt: time.Now().UTC()}, nil
}
