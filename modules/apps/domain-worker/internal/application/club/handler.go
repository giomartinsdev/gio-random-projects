package club

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainclub "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/club"
)

// CommandHandler is what domain-worker calls for every application.Command
// whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainclub.Event, error) {
	switch cmd.Action {
	case application.ActionUpsertClub:
		var in UpsertInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode upsert club payload: %w", err)
		}
		_, evt, err := h.service.Upsert(ctx, in)
		return evt, err

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
