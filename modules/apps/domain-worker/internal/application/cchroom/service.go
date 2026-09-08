package cchroom

import (
	"context"
	"time"

	domaincchroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchroom"
)

// Service is the use case: the only thing that calls
// domaincchroom.Repository's write methods — same shape as
// application/room.Service, minus the lifecycle that aggregate has and
// this one deliberately doesn't.
type Service struct {
	repo domaincchroom.Repository
}

func NewService(repo domaincchroom.Repository) *Service {
	return &Service{repo: repo}
}

// Create writes the entry whole. A zero created_at (the field is
// omitempty on the wire) means "now" — the caller always sends a real
// timestamp, but a hand-rolled command shouldn't mint a room from year
// zero that the sweeper then treats as immortal.
func (s *Service) Create(ctx context.Context, in CreateInput) (domaincchroom.Event, error) {
	createdAt := in.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	r, err := domaincchroom.New(in.ID, createdAt, in.Salt, in.Hash, in.ResumeKey)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Upsert(ctx, r); err != nil {
		return nil, err
	}
	return domaincchroom.Created{RoomID: r.ID, OccurredAt: time.Now().UTC()}, nil
}

// Delete is idempotent by contract with the repo: sweeping a room an
// adm already deleted (or the reverse) is success, not an error — the
// room is gone either way, which is all the caller asked for.
func (s *Service) Delete(ctx context.Context, in DeleteInput) (domaincchroom.Event, error) {
	if in.ID == "" {
		return nil, domaincchroom.ErrIDRequired
	}
	if err := s.repo.Delete(ctx, in.ID); err != nil {
		return nil, err
	}
	return domaincchroom.Deleted{RoomID: in.ID, OccurredAt: time.Now().UTC()}, nil
}