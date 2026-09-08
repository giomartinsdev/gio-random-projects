package cchdeck

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domaincchdeck "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchdeck"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domaincchdeck.Event, error) {
	switch cmd.Action {
	case application.ActionUpsertCCHDeck:
		var in UpsertInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode cchdeck upsert payload: %w", err)
		}
		return h.service.Upsert(ctx, in)

	case application.ActionPlayCCHDeck:
		var in PlayInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode cchdeck play payload: %w", err)
		}
		return h.service.Play(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}