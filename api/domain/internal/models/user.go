package models

import "time"

// User is the only entity implemented so far — the CRUD/event/audit
// pattern here is meant to be copied for the next entity, not extended
// generically (a generic "any entity" abstraction would just be
// indirection with nothing concrete using it yet).
type User struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UserInput is what a client sends on create/update — no ID or
// timestamps, those are server-assigned.
type UserInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}
