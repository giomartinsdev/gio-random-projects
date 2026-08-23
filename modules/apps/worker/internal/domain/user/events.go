package user

import "time"

// Event is implemented by every domain event this aggregate raises.
// EventName exists so infrastructure/redis can label a message on the
// wire without reflection — the domain layer itself never needs it.
type Event interface {
	EventName() string
}

type Created struct {
	UserID     string    `json:"user_id"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "user.created" }

type Updated struct {
	UserID     string    `json:"user_id"`
	Name       string    `json:"name"`
	Email      string    `json:"email"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Updated) EventName() string { return "user.updated" }

type Deleted struct {
	UserID     string    `json:"user_id"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Deleted) EventName() string { return "user.deleted" }
