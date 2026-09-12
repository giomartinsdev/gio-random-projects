package conta

import "time"

// Event is implemented by every domain event this aggregate raises.
type Event interface {
	EventName() string
}

type Created struct {
	ContaID      string    `json:"conta_id"`
	UsuarioEmail string    `json:"usuario_email"`
	Nome         string    `json:"nome"`
	Tipo         string    `json:"tipo"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "conta.created" }

// Updated carries the full current state (not just what changed), same
// convention as room.Updated -- a subscriber never needs a follow-up
// GET to render it.
type Updated struct {
	ContaID      string    `json:"conta_id"`
	UsuarioEmail string    `json:"usuario_email"`
	Nome         string    `json:"nome"`
	Status       string    `json:"status"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Updated) EventName() string { return "conta.updated" }
