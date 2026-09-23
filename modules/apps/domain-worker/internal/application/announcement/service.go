package anuncio

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainannouncement "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/announcement"
)

// Service is the use case for the home feed.
type Service struct {
	repo domainannouncement.Repository
}

func NewService(repo domainannouncement.Repository) *Service {
	return &Service{repo: repo}
}

// Append writes a derived announcement. An unknown tipo is surfaced as an
// error rather than silently coerced — the feed is generated, so a bad tipo
// is a bug in the generator worth seeing.
func (s *Service) Append(ctx context.Context, in AppendInput) error {
	a, err := domainannouncement.New(in.Kind, in.Title, in.Body, in.ReferenciaID, in.Icon, time.Now().UTC())
	if err != nil {
		return err
	}
	if in.ExpiraEmHoras > 0 {
		exp := a.GeneratedAt.Add(time.Duration(in.ExpiraEmHoras) * time.Hour)
		a.ExpiresAt = &exp
	}
	return s.repo.Append(ctx, a)
}

// CommandHandler is what domain-worker calls for this aggregate's actions.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainannouncement.Event, error) {
	switch cmd.Action {
	case application.ActionCreateAnuncio:
		var in AppendInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode create anuncio payload: %w", err)
		}
		return nil, h.service.Append(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
