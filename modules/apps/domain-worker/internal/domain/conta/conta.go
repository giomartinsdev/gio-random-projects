// Package conta is the domain layer for the Conta aggregate — a bank
// or investment account belonging to one usuario (identified only by
// the e-mail carried in their Cloudflare Access JWT). Same shape as
// domain/room: plain Go types and invariants, no database, no HTTP.
// UsuarioEmail is opaque here beyond "not empty" — the real identity
// check (whose JWT this came from) already happened upstream.
package conta

import (
	"errors"
	"time"
)

const (
	TipoCorrente     = "corrente"
	TipoInvestimento = "investimento"
	// TipoAposta is a betting-house wallet: money in, money out, no
	// position to track -- it settles its saldo the same way a corrente
	// does (sum of entradas/saidas), see contas-api's own saldo switch.
	TipoAposta      = "aposta"
	StatusAtiva     = "ativa"
	StatusArquivada = "arquivada"
)

var (
	ErrUsuarioRequired = errors.New("user_email is required")
	ErrNomeRequired    = errors.New("name is required")
	ErrTipoInvalido    = errors.New("kind must be \"corrente\", \"investimento\" or \"aposta\"")
	ErrStatusInvalido  = errors.New("status must be \"ativa\" or \"arquivada\"")
	ErrForbidden       = errors.New("only the owning usuario may modify this conta")
)

type Conta struct {
	ID           string
	UserEmail string
	Name         string
	// Tipo is immutable after creation -- moving money between account
	// kinds is a transacao between two contas, not a change to this one.
	Kind         string
	Status       string
	CreatedAt     time.Time
	UpdatedAt time.Time
}

func validTipo(t string) bool {
	return t == TipoCorrente || t == TipoInvestimento || t == TipoAposta
}
func validStatus(s string) bool { return s == StatusAtiva || s == StatusArquivada }

// New constructs a Conta, always starting it "ativa" -- there's no way
// to create an already-archived account, same as Room always opening
// StatusOpen.
func New(id, userEmail, name, kind string) (Conta, error) {
	if userEmail == "" {
		return Conta{}, ErrUsuarioRequired
	}
	if name == "" {
		return Conta{}, ErrNomeRequired
	}
	if !validTipo(kind) {
		return Conta{}, ErrTipoInvalido
	}

	now := time.Now().UTC()
	return Conta{
		ID:           id,
		UserEmail: userEmail,
		Name:         name,
		Kind:         kind,
		Status:       StatusAtiva,
		CreatedAt:     now,
		UpdatedAt: now,
	}, nil
}

// Edit applies a partial update in place -- nome == "" and status == ""
// both mean "leave unchanged", same convention as Room.Edit. Tipo is
// never editable here since it's immutable after creation.
func (c *Conta) Edit(userEmail, name, status string) error {
	if userEmail != c.UserEmail {
		return ErrForbidden
	}
	if name != "" {
		c.Name = name
	}
	if status != "" {
		if !validStatus(status) {
			return ErrStatusInvalido
		}
		c.Status = status
	}
	c.UpdatedAt = time.Now().UTC()
	return nil
}
