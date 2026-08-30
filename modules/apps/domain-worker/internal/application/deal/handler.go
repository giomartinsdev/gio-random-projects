package deal

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/deal"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

// Handle returns the Deal (not just the event) so the caller can audit
// the entity even when this upsert was an update — updates raise no
// event but still touched a row worth an audit entry.
func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domaindeal.Deal, domaindeal.Event, error) {
	switch cmd.Action {
	case application.ActionUpsertDeal:
		var in UpsertInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return domaindeal.Deal{}, nil, fmt.Errorf("decode upsert payload: %w", err)
		}
		return h.service.Upsert(ctx, in)

	default:
		return domaindeal.Deal{}, nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
