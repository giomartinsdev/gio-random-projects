package dispatch

import "time"

// QueueState explica POR QUE a fila não anda. Sem isso, uma campanha fora da
// janela de envio parece um bug: o operador dispara, vê 29 "na fila" e zero
// enviadas, e não tem como saber que o sistema está esperando as 9h.
//
// É calculado no bootstrap, não no worker, porque é informação de leitura.
type QueueState struct {
	// BlockedBy é "window" quando a janela está fechada, "empty" quando não há
	// nada enfileirado, ou "" quando a fila pode andar.
	BlockedBy  string    `json:"blockedBy"`
	NextOpenAt time.Time `json:"nextOpenAt,omitempty"`
	Timezone   string    `json:"timezone,omitempty"`
}

// ExplainQueue devolve o estado da fila da campanha em execução mais antiga com
// pendências — a mesma que o worker escolheria no próximo tick.
func ExplainQueue(now time.Time, campaignID string, window Window, queued int) QueueState {
	if queued == 0 {
		return QueueState{BlockedBy: "empty"}
	}
	if window.Open(now) {
		return QueueState{BlockedBy: "", Timezone: window.Timezone}
	}
	return QueueState{
		BlockedBy:  "window",
		NextOpenAt: window.NextOpen(now),
		Timezone:   window.Timezone,
	}
}
