package club

import "time"

// Event is implemented by every domain event this aggregate raises.
type Event interface {
	EventName() string
}

// Upserted carries the full current state, same convention as
// conta.Updated — a subscriber never needs a follow-up GET to render it.
type Upserted struct {
	ClubID       string    `json:"club_id"`
	Nome         string    `json:"nome"`
	Sigla        string    `json:"sigla"`
	Acompanhado  bool      `json:"acompanhado"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Upserted) EventName() string { return "club.upserted" }
