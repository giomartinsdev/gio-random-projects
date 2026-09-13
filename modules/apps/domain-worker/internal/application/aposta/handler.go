package aposta

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/aposta"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainaposta.Event, error) {
	switch cmd.Action {
	case application.ActionRegistrarAposta:
		var in RegistrarInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode registrar payload: %w", err)
		}
		_, evt, err := h.service.Registrar(ctx, uuid.NewString(), in)
		return evt, err

	case application.ActionResolverAposta:
		var in ResolverInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode resolver payload: %w", err)
		}
		_, evt, err := h.service.Resolver(ctx, in)
		return evt, err

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
