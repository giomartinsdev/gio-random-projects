package ativo

import "time"

type Event interface {
	EventName() string
}

type Created struct {
	AtivoID      string    `json:"ativo_id"`
	UsuarioEmail string    `json:"usuario_email"`
	ContaID      string    `json:"conta_id"`
	Ticker       string    `json:"ticker"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "ativo.created" }

// MovimentoRegistrado carries the Ativo's full current position (not
// just what changed), same "no follow-up GET needed" convention as
// room.Updated.
type MovimentoRegistrado struct {
	AtivoID            string    `json:"ativo_id"`
	MovimentoID        string    `json:"movimento_id"`
	Tipo               string    `json:"tipo"`
	QuantidadeAtual    float64   `json:"quantidade_atual"`
	CustoMedio         float64   `json:"custo_medio"`
	Status             string    `json:"status"`
	ResultadoRealizado float64   `json:"resultado_realizado,omitempty"`
	OccurredAt         time.Time `json:"occurred_at"`
}

func (MovimentoRegistrado) EventName() string { return "ativo.movimentoRegistrado" }

type CotacaoAtualizada struct {
	AtivoID       string    `json:"ativo_id"`
	UltimaCotacao float64   `json:"ultima_cotacao"`
	OccurredAt    time.Time `json:"occurred_at"`
}

func (CotacaoAtualizada) EventName() string { return "ativo.cotacaoAtualizada" }
