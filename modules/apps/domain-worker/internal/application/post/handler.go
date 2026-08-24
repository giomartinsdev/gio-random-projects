package post

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/post"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainpost.Event, error) {
	switch cmd.Action {
	case application.ActionCreatePost:
		var in CreateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode create payload: %w", err)
		}
		_, evt, err := h.service.Create(ctx, uuid.NewString(), in)
		return evt, err

	case application.ActionUpdatePost:
		var in UpdateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode update payload: %w", err)
		}
		_, evt, err := h.service.Update(ctx, in)
		return evt, err

	case application.ActionDeletePost:
		var in DeleteInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode delete payload: %w", err)
		}
		return h.service.Delete(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
