package cchroom

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domaincchroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchroom"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domaincchroom.Event, error) {
	switch cmd.Action {
	case application.ActionCreateCCHRoom:
		var in CreateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode cchroom create payload: %w", err)
		}
		return h.service.Create(ctx, in)

	case application.ActionDeleteCCHRoom:
		var in DeleteInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode cchroom delete payload: %w", err)
		}
		return h.service.Delete(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}