package anuncio

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainanuncio "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/anuncio"
)

// Service is the use case for the home feed.
type Service struct {
	repo domainanuncio.Repository
}

func NewService(repo domainanuncio.Repository) *Service {
	return &Service{repo: repo}
}

// Append writes a derived announcement. An unknown tipo is surfaced as an
// error rather than silently coerced — the feed is generated, so a bad tipo
// is a bug in the generator worth seeing.
func (s *Service) Append(ctx context.Context, in AppendInput) error {
	a, err := domainanuncio.New(in.Tipo, in.Titulo, in.Texto, in.ReferenciaID, in.Icone, time.Now().UTC())
	if err != nil {
		return err
	}
	if in.ExpiraEmHoras > 0 {
		exp := a.GeradoEm.Add(time.Duration(in.ExpiraEmHoras) * time.Hour)
		a.ExpiraEm = &exp
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

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainanuncio.Event, error) {
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
