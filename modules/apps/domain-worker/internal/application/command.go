// Package application is domain-worker's use-case layer: the Command
// envelope, ports (what infrastructure must provide), and one
// subpackage per aggregate wiring the two together. domain-api has its
// own, smaller copy of this package (just Command + CommandPublisher)
// since it only ever produces commands, never applies them.
package application

import "encoding/json"

type Action string

const (
	ActionCreateUser Action = "user.create"
	ActionUpdateUser Action = "user.update"
	ActionDeleteUser Action = "user.delete"

	ActionCreatePost Action = "post.create"
	ActionUpdatePost Action = "post.update"
	ActionDeletePost Action = "post.delete"
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
