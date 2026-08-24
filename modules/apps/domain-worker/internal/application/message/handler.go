package message

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainmessage "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/message"
)

type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainmessage.Event, error) {
	switch cmd.Action {
	case application.ActionCreateMessage:
		var in CreateInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode create payload: %w", err)
		}
		_, evt, err := h.service.Create(ctx, uuid.NewString(), in)
		return evt, err

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
