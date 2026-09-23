package transacao

import "time"

type Event interface {
	EventName() string
}

type Created struct {
	TransacaoID  string    `json:"transacao_id"`
	UserEmail string    `json:"user_email"`
	ContaID      string    `json:"conta_id"`
	Kind         string    `json:"kind"`
	Valor        float64   `json:"valor"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "transacao.created" }

type Updated struct {
	TransacaoID  string    `json:"transacao_id"`
	UserEmail string    `json:"user_email"`
	ContaID      string    `json:"conta_id"`
	Kind         string    `json:"kind"`
	Valor        float64   `json:"valor"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Updated) EventName() string { return "transacao.updated" }

type Deleted struct {
	TransacaoID  string    `json:"transacao_id"`
	UserEmail string    `json:"user_email"`
	ContaID      string    `json:"conta_id"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Deleted) EventName() string { return "transacao.deleted" }
