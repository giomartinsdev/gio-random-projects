package prospecta

import (
	"errors"
	"time"
)

// Erros do agregado AgentRun.
var (
	ErrAgentRequired = errors.New("agent is required")
)

// AgentRunAgent identifica qual agente do núcleo agêntico executou.
type AgentRunAgent string

const (
	AgentProspector AgentRunAgent = "prospector"
	AgentResearcher AgentRunAgent = "researcher"
	AgentComposer   AgentRunAgent = "composer"
	AgentQualifier  AgentRunAgent = "qualifier"
)

// AgentRunState é o estado de um run (data-model §7).
type AgentRunState string

const (
	AgentRunRunning AgentRunState = "running"
	AgentRunDone    AgentRunState = "done"
	AgentRunFailed  AgentRunState = "failed"
)

// AgentRun é a execução de um agente sobre uma campanha. RequestProspect abre
// um run do prospector em running; o núcleo agêntico o fecha. É também a fonte
// do feed de atividade do Cockpit.
type AgentRun struct {
	ID         string
	TenantID   string
	CampaignID string
	Agent      AgentRunAgent
	State      AgentRunState
	Metrics    map[string]any
	StartedAt  time.Time
	EndedAt    *time.Time
}

// NewAgentRun abre um run em running. Exige campanha e agente — um run sem dono
// não tem como ser retomado nem lido.
func NewAgentRun(id, tenantID, campaignID string, agent AgentRunAgent) (AgentRun, error) {
	if tenantID == "" {
		return AgentRun{}, ErrTenantIDRequired
	}
	if campaignID == "" {
		return AgentRun{}, ErrCampaignIDRequired
	}
	if agent == "" {
		return AgentRun{}, ErrAgentRequired
	}
	return AgentRun{
		ID:         id,
		TenantID:   tenantID,
		CampaignID: campaignID,
		Agent:      agent,
		State:      AgentRunRunning,
	}, nil
}
