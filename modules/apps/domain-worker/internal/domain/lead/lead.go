// Package lead is the domain layer for the Lead aggregate: an e-mail
// address captured on the financas-frontend landing page (specs/
// 002-gestao-financeira-modular's marketing surface — see leads-api's
// own README), before that person ever authenticates. No usuario_email
// scoping here on purpose: leads aren't owned by anyone yet, they're
// what turns INTO a pessoa usuária.
package lead

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrEmailRequired = errors.New("email is required")
	ErrEmailInvalido = errors.New("email inválido")
)

type Lead struct {
	ID       string
	Email    string
	CreatedAt time.Time
}

// New validates just enough to keep garbage out (a real deliverability
// check belongs to whoever later emails these people, not here): a
// non-empty address with exactly one "@" and something on both sides.
func New(id, email string) (Lead, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return Lead{}, ErrEmailRequired
	}
	at := strings.IndexByte(email, '@')
	if at <= 0 || at == len(email)-1 || strings.ContainsRune(email[at+1:], '@') {
		return Lead{}, ErrEmailInvalido
	}
	return Lead{ID: id, Email: email, CreatedAt: time.Now().UTC()}, nil
}
