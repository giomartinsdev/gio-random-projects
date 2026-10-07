package domain

// AgentRunEvent is one live agent_run sample streamed to the cockpit. It
// mirrors the prospecta.agent_run projection and the contract's SSE payload:
//
//	event: agent
//	data: {"run_id":"...","agent":"prospector","state":"running","metric":{"found":12}}
type AgentRunEvent struct {
	RunID  string         `json:"run_id"`
	Agent  string         `json:"agent"`
	State  string         `json:"state"`
	Metric map[string]any `json:"metric,omitempty"`
}
