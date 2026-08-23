package user

import (
	"context"
	"time"

	domainuser "github.com/giomartinsdev/gio-random-projects/api/domain/src/domain/user"
)

// Service is the use case: it's the only thing in this codebase that
// calls domainuser.Repository's write methods, so every mutation to a
// User goes through the aggregate's own invariants (New/Rename) on the
// way — there's no path that writes a row without constructing a valid
// domainuser.User first.
type Service struct {
	repo domainuser.Repository
}

func NewService(repo domainuser.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, id string, in CreateInput) (domainuser.User, domainuser.Event, error) {
	u, err := domainuser.New(id, in.Name, in.Email)
	if err != nil {
		return domainuser.User{}, nil, err
	}
	if err := s.repo.Insert(ctx, u); err != nil {
		return domainuser.User{}, nil, err
	}
	return u, domainuser.Created{UserID: u.ID, Name: u.Name, Email: u.Email, OccurredAt: u.CreatedAt}, nil
}

func (s *Service) Update(ctx context.Context, in UpdateInput) (domainuser.User, domainuser.Event, error) {
	u, err := s.repo.FindByID(ctx, in.ID)
	if err != nil {
		return domainuser.User{}, nil, err
	}
	if err := u.Rename(in.Name, in.Email); err != nil {
		return domainuser.User{}, nil, err
	}
	if err := s.repo.Update(ctx, u); err != nil {
		return domainuser.User{}, nil, err
	}
	return u, domainuser.Updated{UserID: u.ID, Name: u.Name, Email: u.Email, OccurredAt: u.UpdatedAt}, nil
}

func (s *Service) Delete(ctx context.Context, in DeleteInput) (domainuser.Event, error) {
	if err := s.repo.Delete(ctx, in.ID); err != nil {
		return nil, err
	}
	return domainuser.Deleted{UserID: in.ID, OccurredAt: time.Now().UTC()}, nil
}
