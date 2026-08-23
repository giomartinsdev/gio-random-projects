// Package user is the domain layer for the User aggregate as seen from
// domain-api: just enough to read and validate, since this binary
// never writes — see internal/infrastructure/http's package doc.
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
