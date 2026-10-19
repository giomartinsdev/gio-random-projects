// Package dispatch é o que transforma "campanha em execução" em mensagens
// enviadas. Duas responsabilidades, testadas juntas de propósito:
//
//   - a política de janela/vazão (Window, pura, sem I/O), que decide se agora é
//     hora de mandar e quantas cabem neste minuto;
//   - o Worker, que puxa a fila do banco e chama o provedor.
//
// A política fica separada porque é a parte que dá para errar em silêncio: um
// fuso trocado manda mensagem às 3h da manhã e o operador só descobre pelo
// cliente reclamando.
package dispatch

import (
	"time"
)

// Window é a janela de disparo de uma campanha.
type Window struct {
	Start    int   // 0–23, hora local
	End      int   // 0–23, exclusiva
	Days     []int // 0 = domingo
	Timezone string
	Throttle int // mensagens por minuto
}

// Open diz se o horário local `now` está dentro da janela. Janela invertida
// (ex.: 21 → 8, madrugada) é suportada: cruzar a meia-noite é o caso comum de
// "fora do horário comercial".
func (w Window) Open(now time.Time) bool {
	if w.Start == 0 && w.End == 0 {
		return true // sem restrição declarada
	}
	loc, err := time.LoadLocation(w.Timezone)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)

	if len(w.Days) > 0 {
		allowed := false
		for _, d := range w.Days {
			if d == int(local.Weekday()) {
				allowed = true
				break
			}
		}
		if !allowed {
			return false
		}
	}

	hour := local.Hour()
	if w.Start < w.End {
		return hour >= w.Start && hour < w.End
	}
	// Atravessa a meia-noite: [start, 24) ∪ [0, end)
	return hour >= w.Start || hour < w.End
}

// NextOpen devolve o próximo instante em que a janela abre, para o log/UX não
// ficar com um "aguardando" sem prazo. Não é usado para agendar nada — o worker
// só reconsulta a cada tick.
func (w Window) NextOpen(now time.Time) time.Time {
	if w.Open(now) {
		return now
	}
	loc, err := time.LoadLocation(w.Timezone)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	for i := 0; i < 8*24; i++ {
		candidate := local.Add(time.Duration(i) * time.Hour).Truncate(time.Hour)
		if w.Open(candidate) {
			return candidate
		}
	}
	return now
}

// BatchSize é quantas mensagens cabem neste tick sem estourar o throttle. O
// mínimo é 1: com throttle 0 (não configurado), mandar uma por vez é mais
// seguro do que mandar tudo de uma vez e tomar bloqueio da Meta.
func (w Window) BatchSize(tick time.Duration) int {
	if w.Throttle <= 0 {
		return 1
	}
	perTick := int(float64(w.Throttle) * tick.Minutes())
	if perTick < 1 {
		return 1
	}
	return perTick
}
