package aposta

import "time"

// Event is implemented by every domain event this aggregate raises.
type Event interface {
	EventName() string
}

type Registrada struct {
	ApostaID      string    `json:"aposta_id"`
	UserEmail  string    `json:"user_email"`
	ContaID       string    `json:"conta_id"`
	ValorApostado float64   `json:"valor_apostado"`
	OccurredAt    time.Time `json:"occurred_at"`
}

func (Registrada) EventName() string { return "aposta.registrada" }

// Resolvida carries the full current state (not just what changed),
// same convention as conta.Updated -- a subscriber never needs a
// follow-up GET to render it.
type Resolvida struct {
	ApostaID      string    `json:"aposta_id"`
	Status        string    `json:"status"`
	RetornoObtido float64   `json:"retorno_obtido,omitempty"`
	OccurredAt    time.Time `json:"occurred_at"`
}

func (Resolvida) EventName() string { return "aposta.resolvida" }
