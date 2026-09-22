package partida

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainpartida "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/partida"
)

// CommandHandler is what domain-worker calls for every application.Command
// whose Action belongs to this aggregate.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainpartida.Event, error) {
	switch cmd.Action {
	case application.ActionUpsertPartida:
		var in UpsertInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode upsert partida payload: %w", err)
		}
		_, evt, err := h.service.UpsertMatch(ctx, in)
		if evt != nil {
			return *evt, err
		}
		return nil, err

	case application.ActionUpsertClubeTotais:
		var in TotaisInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode upsert totais payload: %w", err)
		}
		return nil, h.service.UpsertTotais(ctx, in)

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
