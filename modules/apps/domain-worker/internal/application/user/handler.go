package user

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/user"
	"github.com/google/uuid"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue — the only place that knows how a generic
// Command's Payload maps onto this aggregate's concrete inputs.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

// Handle applies cmd and returns the domain event it produced. The
// caller (domain-worker's main loop) is responsible for auditing and
// publishing that event — this stays focused on "what happened to the
// aggregate", not on side effects of the fact that it happened.
func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainuser.Event, error) {
	switch cmd.Action {
	case application.ActionCreateUser:
		var in CreateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode create payload: %w", err)
		}
		_, evt, err := h.service.Create(ctx, uuid.NewString(), in)
		return evt, err

	case application.ActionUpdateUser:
		var in UpdateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode update payload: %w", err)
		}
		_, evt, err := h.service.Update(ctx, in)
		return evt, err

	case application.ActionDeleteUser:
		var in DeleteInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode delete payload: %w", err)
		}
		return h.service.Delete(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
