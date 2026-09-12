package dashboardlayout

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/dashboardlayout"
)

// CommandHandler is what domain-worker calls for every application.Command
// it pops off the queue whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domaindashboardlayout.Event, error) {
	switch cmd.Action {
	case application.ActionSaveDashboardLayout:
		var in SaveInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode save payload: %w", err)
		}
		return h.service.Save(ctx, in)

	case application.ActionDeleteDashboardLayout:
		var in DeleteInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode delete payload: %w", err)
		}
		return h.service.Delete(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
