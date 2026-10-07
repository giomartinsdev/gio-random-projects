package application

import (
	"context"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// UpdateAgentRunInput is the POST /agent/runs/{id} body the agent uses to move
// the run it owns: state ∈ running|done|failed, plus optional metrics.
type UpdateAgentRunInput struct {
	State   string         `json:"state"`
	Metrics map[string]any `json:"metrics"`
}

// AgentService is the use-case layer for the agent-run slice. The run is NOT
// created here: RequestProspect opened it and its id arrived in the
// ProspectRequested event. The agent only updates it.
type AgentService struct {
	publisher CommandPublisher
}

func NewAgentService(publisher CommandPublisher) *AgentService {
	return &AgentService{publisher: publisher}
}

// UpdateAgentRun validates the state and publishes UpdateAgentRun for the run
// named by the path. An invalid state is rejected before publishing.
func (s *AgentService) UpdateAgentRun(ctx context.Context, runID string, in UpdateAgentRunInput) (string, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return "", domain.ErrRunIDRequired
	}
	state := strings.TrimSpace(in.State)
	if !domain.ValidAgentRunState(state) {
		return "", domain.ErrInvalidRunState
	}
	payload := map[string]any{
		"run_id": runID,
		"state":  state,
	}
	if in.Metrics != nil {
		payload["metrics"] = in.Metrics
	}
	return s.publisher.Publish(ctx, ActionUpdateAgentRun, payload)
}
