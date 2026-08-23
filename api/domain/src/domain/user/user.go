// Package user is the domain layer for the User aggregate — plain Go
// types and business rules, no database, no HTTP, no Redis. Everything
// here should be understandable (and testable) without knowing this is
// even a web service.
package user

import (
	"errors"
	"time"
)

var (
	ErrNameRequired  = errors.New("name is required")
	ErrEmailRequired = errors.New("email is required")
)

type User struct {
	ID        string
	Name      string
	Email     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// New constructs a User, enforcing the aggregate's invariants at the
// one place they can't be bypassed — every other path to a User
// (repository loads included) assumes these already held.
func New(id, name, email string) (User, error) {
	if name == "" {
		return User{}, ErrNameRequired
	}
	if email == "" {
		return User{}, ErrEmailRequired
	}
	now := time.Now().UTC()
	return User{ID: id, Name: name, Email: email, CreatedAt: now, UpdatedAt: now}, nil
}

// Rename applies a profile update in place — the only way Name/Email
// change after construction, so UpdatedAt can't drift out of sync with
// an edit made some other way.
func (u *User) Rename(name, email string) error {
	if name == "" {
		return ErrNameRequired
	}
	if email == "" {
		return ErrEmailRequired
	}
	u.Name = name
	u.Email = email
	u.UpdatedAt = time.Now().UTC()
	return nil
}
