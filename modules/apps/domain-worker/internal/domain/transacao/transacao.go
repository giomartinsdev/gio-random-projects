// Package transacao is the domain layer for the Transacao aggregate --
// a single entrada/saida posted against one Conta. ContaID is an
// opaque foreign key, same treatment domain/room gives DocumentID:
// this package never reaches into conta to validate it exists or is
// owned by the same usuario -- the application layer does that lookup
// before calling New (see application/transacao.Service).
package transacao

import (
	"errors"
	"time"
)

const (
	TipoEntrada = "entrada"
	TipoSaida   = "saida"
)

var (
	ErrUsuarioRequired   = errors.New("usuario_email is required")
	ErrContaRequired     = errors.New("conta_id is required")
	ErrCategoriaRequired = errors.New("categoria is required")
	ErrTipoInvalido      = errors.New("tipo must be \"entrada\" or \"saida\"")
	ErrValorInvalido     = errors.New("valor must be greater than zero")
	ErrDataInvalida      = errors.New("data is required")
	ErrForbidden         = errors.New("only the owning usuario may modify this transacao")
)

type Transacao struct {
	ID           string
	UsuarioEmail string
	ContaID      string
	Tipo         string
	Valor        float64
	// Data only carries the calendar date -- New/Edit normalize any
	// time-of-day component away with time.Date so two transacoes on
	// the same day compare equal regardless of what a caller sent.
	Data      time.Time
	Categoria string
	Descricao string
	// AnexoImagem is an opaque base64 blob, not processed/validated in
	// this phase -- same "opaque to the domain" treatment as Room's
	// DocumentID.
	AnexoImagem  string
	CriadoEm     time.Time
	AtualizadoEm time.Time
}

func validTipo(t string) bool { return t == TipoEntrada || t == TipoSaida }

func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// New constructs a Transacao, enforcing the aggregate's invariants at
// the one place they can't be bypassed.
func New(id, usuarioEmail, contaID, tipo string, valor float64, data time.Time, categoria, descricao, anexoImagem string) (Transacao, error) {
	if usuarioEmail == "" {
		return Transacao{}, ErrUsuarioRequired
	}
	if contaID == "" {
		return Transacao{}, ErrContaRequired
	}
	if categoria == "" {
		return Transacao{}, ErrCategoriaRequired
	}
	if !validTipo(tipo) {
		return Transacao{}, ErrTipoInvalido
	}
	if valor <= 0 {
		return Transacao{}, ErrValorInvalido
	}
	if data.IsZero() {
		return Transacao{}, ErrDataInvalida
	}

	now := time.Now().UTC()
	return Transacao{
		ID:           id,
		UsuarioEmail: usuarioEmail,
		ContaID:      contaID,
		Tipo:         tipo,
		Valor:        valor,
		Data:         dateOnly(data),
		Categoria:    categoria,
		Descricao:    descricao,
		AnexoImagem:  anexoImagem,
		CriadoEm:     now,
		AtualizadoEm: now,
	}, nil
}

// Edit applies a partial update in place -- tipo == "", valor == nil,
// data == nil, categoria == "", descricao == "" and anexoImagem == ""
// all mean "leave unchanged", same convention as Room.Edit.
func (tr *Transacao) Edit(usuarioEmail, tipo string, valor *float64, data *time.Time, categoria, descricao, anexoImagem string) error {
	if usuarioEmail != tr.UsuarioEmail {
		return ErrForbidden
	}
	if tipo != "" {
		if !validTipo(tipo) {
			return ErrTipoInvalido
		}
		tr.Tipo = tipo
	}
	if valor != nil {
		if *valor <= 0 {
			return ErrValorInvalido
		}
		tr.Valor = *valor
	}
	if data != nil {
		if data.IsZero() {
			return ErrDataInvalida
		}
		tr.Data = dateOnly(*data)
	}
	if categoria != "" {
		tr.Categoria = categoria
	}
	if descricao != "" {
		tr.Descricao = descricao
	}
	if anexoImagem != "" {
		tr.AnexoImagem = anexoImagem
	}
	tr.AtualizadoEm = time.Now().UTC()
	return nil
}
