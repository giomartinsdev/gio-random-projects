// Package application holds the use-case layer: commands (intent),
// ports (what infrastructure must provide), and one subpackage per
// aggregate wiring the two together. It depends on domain/, never the
// other way around, and infrastructure/ depends on this — never
// infrastructure back into application.
package application

import "encoding/json"

// Action identifies what a Command intends to do — namespaced by
// aggregate (user.create, not just create) since every command crossing
// the bus shares one channel regardless of which aggregate it targets.
type Action string

const (
	ActionCreateUser Action = "user.create"
	ActionUpdateUser Action = "user.update"
	ActionDeleteUser Action = "user.delete"
)

// Command is the transport envelope domain-api publishes and
// domain-worker consumes — a generic shell around an aggregate-specific
// payload (see application/user's *Input types), so the bus and the
// relay/queue bridge in infrastructure/redis never need to know about
// User specifically.
type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
