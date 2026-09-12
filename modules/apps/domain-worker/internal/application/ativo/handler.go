package ativo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativo"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate -- it
// covers both Ativo's own create/updateQuote actions and the
// registerMovement action that mutates it via its AtivoMovimento
// child records, since neither exists without the other.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainativo.Event, error) {
	switch cmd.Action {
	case application.ActionCreateAtivo:
		var in CreateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode create payload: %w", err)
		}
		_, evt, err := h.service.Create(ctx, uuid.NewString(), in)
		return evt, err

	case application.ActionRegisterAtivoMovimento:
		var in RegisterMovementInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode register movement payload: %w", err)
		}
		_, evt, err := h.service.RegisterMovement(ctx, in)
		return evt, err

	case application.ActionUpdateAtivoQuote:
		var in UpdateQuoteInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode update quote payload: %w", err)
		}
		return h.service.UpdateQuote(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
