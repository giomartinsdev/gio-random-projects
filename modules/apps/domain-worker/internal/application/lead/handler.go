package lead

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainlead "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/lead"
)

type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainlead.Event, error) {
	switch cmd.Action {
	case application.ActionCaptureLead:
		var in CaptureInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode capture payload: %w", err)
		}
		_, evt, err := h.service.Capture(ctx, uuid.NewString(), in)
		return evt, err

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
