// Package aposta is the domain layer for the Aposta aggregate -- a
// single bet placed at a betting house (a Conta of tipo "aposta"), with
// its own lifecycle: pendente -> green | red | cancelada. Unlike Ativo
// it never accumulates a running position; each Aposta is one event.
// The money side (debiting the stake on registration, crediting a
// payout on green/cancelada) is NOT this aggregate's job -- it's
// orchestrated by apostas-api publishing a separate transacao.create
// command, same "aggregates stay isolated, the caller sequences two
// /sync writes" pattern proventos-worker already established for
// crediting a conta from outside domain-worker.
package aposta

import (
	"errors"
	"time"
)

const (
	StatusPendente  = "pendente"
	StatusGreen     = "green"
	StatusRed       = "red"
	StatusCancelada = "cancelada"
)

var (
	ErrUsuarioRequired   = errors.New("user_email is required")
	ErrContaRequired     = errors.New("conta_id is required")
	ErrDescricaoRequired = errors.New("descricao is required")
	ErrValorInvalido     = errors.New("valor_apostado must be greater than zero")
	ErrDataInvalida      = errors.New("data_aposta is required")
	ErrStatusInvalido    = errors.New("status must be \"green\", \"red\" or \"cancelada\"")
	ErrRetornoInvalido   = errors.New("retorno_obtido must be greater than zero for a green result")
	ErrApostaJaResolvida = errors.New("aposta already has a result")
)

type Aposta struct {
	ID            string
	UserEmail  string
	ContaID       string
	Descricao     string
	ValorApostado float64
	// Odd is optional -- a suggested return, not enforced against
	// RetornoObtido (bônus, cashout parcial etc. can make them differ).
	Odd           float64
	Status        string
	RetornoObtido float64
	DataAposta    time.Time
	// DataResultado's zero value means "still pendente".
	DataResultado time.Time
	CreatedAt      time.Time
	UpdatedAt  time.Time
}

func validStatusResolucao(s string) bool {
	return s == StatusGreen || s == StatusRed || s == StatusCancelada
}

// New registers a bet, always starting it "pendente" -- there is no way
// to create an already-resolved Aposta, same reasoning as Ativo always
// opening "aberta".
func New(id, userEmail, contaID, descricao string, valorApostado, odd float64, data time.Time) (Aposta, error) {
	if userEmail == "" {
		return Aposta{}, ErrUsuarioRequired
	}
	if contaID == "" {
		return Aposta{}, ErrContaRequired
	}
	if descricao == "" {
		return Aposta{}, ErrDescricaoRequired
	}
	if valorApostado <= 0 {
		return Aposta{}, ErrValorInvalido
	}
	if data.IsZero() {
		return Aposta{}, ErrDataInvalida
	}

	now := time.Now().UTC()
	return Aposta{
		ID:            id,
		UserEmail:  userEmail,
		ContaID:       contaID,
		Descricao:     descricao,
		ValorApostado: valorApostado,
		Odd:           odd,
		Status:        StatusPendente,
		DataAposta:    data,
		CreatedAt:      now,
		UpdatedAt:  now,
	}, nil
}

// Resolver settles a pendente Aposta -- green requires a positive
// retornoObtido (the total payout, stake included); red carries none
// (the loss is already reflected by the stake debited at registration);
// cancelada refunds exactly the stake, regardless of what the caller
// passes as retornoObtido.
func (a Aposta) Resolver(status string, retornoObtido float64, dataResultado time.Time) (Aposta, error) {
	if a.Status != StatusPendente {
		return Aposta{}, ErrApostaJaResolvida
	}
	if !validStatusResolucao(status) {
		return Aposta{}, ErrStatusInvalido
	}
	if status == StatusGreen && retornoObtido <= 0 {
		return Aposta{}, ErrRetornoInvalido
	}
	if dataResultado.IsZero() {
		dataResultado = time.Now().UTC()
	}

	a.Status = status
	switch status {
	case StatusGreen:
		a.RetornoObtido = retornoObtido
	case StatusCancelada:
		a.RetornoObtido = a.ValorApostado
	}
	a.DataResultado = dataResultado
	a.UpdatedAt = time.Now().UTC()
	return a, nil
}
