// Package events defines the two message shapes that cross the Redis
// bus and the channel/queue/topic names both services agree on.
//
//	domain-api --publish--> CommandChannel (pub/sub)
//	            [domain-worker subscribes and relays into:]
//	                         CommandQueue (list, durable buffer)
//	            [domain-worker BLPOPs, applies the write, then:]
//	            --publish--> ProcessedChannel (pub/sub, for anything
//	                         downstream that wants to react — nothing
//	                         subscribes to it yet)
package events

const (
	CommandChannel   = "domain.commands"
	CommandQueue     = "domain.commands.queue"
	ProcessedChannel = "domain.events"
)

type Action string

const (
	ActionCreate Action = "create"
	ActionUpdate Action = "update"
	ActionDelete Action = "delete"
)

// Command is what domain-api publishes — an intent, not yet applied.
// EntityID is empty for create (the worker assigns one).
type Command struct {
	ID         string `json:"id"`
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id,omitempty"`
	Action     Action `json:"action"`
	Payload    any    `json:"payload,omitempty"`
}

// Processed is what domain-worker publishes after handling a Command —
// carries the outcome, not just an ack, so a subscriber can tell success
// from failure without a separate lookup.
type Processed struct {
	CommandID  string `json:"command_id"`
	EntityType string `json:"entity_type"`
	EntityID   string `json:"entity_id,omitempty"`
	Action     Action `json:"action"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
	Result     any    `json:"result,omitempty"`
}
