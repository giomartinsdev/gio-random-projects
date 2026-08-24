package room

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/room"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainroom.Event, error) {
	switch cmd.Action {
	case application.ActionCreateRoom:
		var in CreateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode create payload: %w", err)
		}
		_, evt, err := h.service.Create(ctx, uuid.NewString(), in)
		return evt, err

	case application.ActionUpdateRoom:
		var in UpdateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode update payload: %w", err)
		}
		_, evt, err := h.service.Update(ctx, in)
		return evt, err

	case application.ActionDeleteRoom:
		var in DeleteInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode delete payload: %w", err)
		}
		return h.service.Delete(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
