// Package dashboardlayout is the domain layer for a usuario's saved
// dashboard layout -- one row per usuario_email, holding whatever
// array of "blocos" dashboard-api's frontend last saved. Blocos is
// opaque JSON here, same treatment domain/room gives DocumentID: this
// package only checks it's a well-formed JSON array, never what's
// inside each element -- that shape is dashboard-api's business, not
// this aggregate's.
package dashboardlayout

import (
	"bytes"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrUsuarioRequired = errors.New("usuario_email is required")
	ErrBlocosInvalido  = errors.New("blocos must be a valid JSON array")
)

type DashboardLayout struct {
	UsuarioEmail string
	Blocos       json.RawMessage
	AtualizadoEm time.Time
}

func validBlocos(b json.RawMessage) bool {
	if !json.Valid(b) {
		return false
	}
	trimmed := bytes.TrimSpace(b)
	return len(trimmed) > 0 && trimmed[0] == '['
}

// Save constructs (or replaces) the DashboardLayout for one usuario --
// there's no separate New/Edit split here since this aggregate is a
// single upsertable row per usuario_email, not a lifecycle with
// distinct create/update rules.
func Save(usuarioEmail string, blocos json.RawMessage) (DashboardLayout, error) {
	if usuarioEmail == "" {
		return DashboardLayout{}, ErrUsuarioRequired
	}
	if !validBlocos(blocos) {
		return DashboardLayout{}, ErrBlocosInvalido
	}
	return DashboardLayout{
		UsuarioEmail: usuarioEmail,
		Blocos:       blocos,
		AtualizadoEm: time.Now().UTC(),
	}, nil
}
