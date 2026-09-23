package conta

import "time"

// Event is implemented by every domain event this aggregate raises.
type Event interface {
	EventName() string
}

type Created struct {
	ContaID      string    `json:"conta_id"`
	UserEmail string    `json:"user_email"`
	Name         string    `json:"name"`
	Kind         string    `json:"kind"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "conta.created" }

// Updated carries the full current state (not just what changed), same
// convention as room.Updated -- a subscriber never needs a follow-up
// GET to render it.
type Updated struct {
	ContaID      string    `json:"conta_id"`
	UserEmail string    `json:"user_email"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Updated) EventName() string { return "conta.updated" }
