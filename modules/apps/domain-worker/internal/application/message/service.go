package message

import (
	"context"

	domainmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/message"
)

type Service struct {
	repo domainmessage.Repository
}

func NewService(repo domainmessage.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Create(ctx context.Context, id string, in CreateInput) (domainmessage.Message, domainmessage.Event, error) {
	m, err := domainmessage.New(id, in.RoomID, in.UserID, in.UserName, in.Body, in.RequestedPage)
	if err != nil {
		return domainmessage.Message{}, nil, err
	}
	if err := s.repo.Insert(ctx, m); err != nil {
		return domainmessage.Message{}, nil, err
	}
	return m, domainmessage.Created{
		MessageID: m.ID, RoomID: m.RoomID, UserID: m.UserID, UserName: m.UserName,
		Body: m.Body, RequestedPage: m.RequestedPage, OccurredAt: m.CreatedAt,
	}, nil
}
