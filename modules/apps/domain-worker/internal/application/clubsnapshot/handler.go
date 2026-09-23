package clubesnapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domainsnapshot "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/clubsnapshot"
)

// Service is the use case for the snapshot append.
type Service struct {
	repo domainsnapshot.Repository
}

func NewService(repo domainsnapshot.Repository) *Service {
	return &Service{repo: repo}
}

// Append records the reading and returns the division change it produced,
// if any.
func (s *Service) Append(ctx context.Context, in AppendInput) (*domainsnapshot.MudancaDivisao, error) {
	snap, err := domainsnapshot.New(in.ClubID, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	snap.SkillRating = in.SkillRating
	snap.DivisionAtRead = in.DivisionAtRead
	snap.Played = in.Played
	snap.Wins = in.Wins
	snap.Draws = in.Draws
	snap.Losses = in.Losses
	snap.Goals = in.Goals
	snap.GoalsConceded = in.GoalsConceded
	snap.SquadSize = in.SquadSize
	return s.repo.Append(ctx, snap)
}

// CommandHandler is what domain-worker calls for this aggregate's actions.
// A snapshot raises no domain event of its own — the division change is
// recorded in the same transaction and read back by the API — so Handle
// always returns a nil event.
type CommandHandler struct {
	service *Service
}

func NewCommandHandler(service *Service) *CommandHandler {
	return &CommandHandler{service: service}
}

func (h *CommandHandler) Handle(ctx context.Context, cmd application.Command) (domainsnapshot.Event, error) {
	switch cmd.Action {
	case application.ActionAppendSnapshot:
		var in AppendInput
		if err := json.Unmarshal(cmd.Payload, &in); err != nil {
			return nil, fmt.Errorf("decode append snapshot payload: %w", err)
		}
		_, err := h.service.Append(ctx, in)
		return nil, err

	default:
		return nil, fmt.Errorf("unknown action: %q", cmd.Action)
	}
}
