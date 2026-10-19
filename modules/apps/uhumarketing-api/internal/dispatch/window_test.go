package dispatch

import (
	"testing"
	"time"
)

// A janela é a parte que erra em silêncio: fuso trocado manda mensagem às 3h da
// manhã e o operador só descobre com reclamação. Por isso ela é pura e testada
// aqui, sem banco e sem rede.

func at(t *testing.T, layout, value string) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatalf("fuso: %v", err)
	}
	parsed, err := time.ParseInLocation(layout, value, loc)
	if err != nil {
		t.Fatalf("parse %q: %v", value, err)
	}
	return parsed
}

func TestWindowOpen(t *testing.T) {
	// 2026-10-19 é uma segunda-feira.
	cases := []struct {
		name  string
		when  string
		start int
		end   int
		days  []int
		want  bool
	}{
		{"dentro do horário comercial", "2026-10-19 10:00", 9, 18, nil, true},
		{"antes de abrir", "2026-10-19 08:59", 9, 18, nil, false},
		{"no instante de fechar", "2026-10-19 18:00", 9, 18, nil, false},
		{"último minuto antes de fechar", "2026-10-19 17:59", 9, 18, nil, true},
		{"sábado fora dos dias úteis", "2026-10-17 10:00", 9, 18, []int{1, 2, 3, 4, 5}, false},
		{"segunda nos dias úteis", "2026-10-19 10:00", 9, 18, []int{1, 2, 3, 4, 5}, true},
		{"madrugada de janela invertida", "2026-10-19 02:00", 21, 8, nil, true},
		{"meio da tarde fora da janela noturna", "2026-10-19 15:00", 21, 8, nil, false},
		{"sem restrição declarada", "2026-10-19 03:00", 0, 0, nil, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := Window{Start: tc.start, End: tc.end, Days: tc.days, Timezone: "America/Sao_Paulo"}
			if got := w.Open(at(t, "2006-01-02 15:04", tc.when)); got != tc.want {
				t.Fatalf("Open(%s) = %v, esperava %v", tc.when, got, tc.want)
			}
		})
	}
}

func TestWindowRespectsTimezone(t *testing.T) {
	// 12:00 UTC é 09:00 em São Paulo. Se o serviço rodar em UTC e esquecer o
	// fuso da campanha, a janela abre três horas antes.
	utc := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	w := Window{Start: 9, End: 18, Timezone: "America/Sao_Paulo"}
	if !w.Open(utc) {
		t.Fatal("09:00 em São Paulo deveria estar aberto")
	}
	w = Window{Start: 10, End: 18, Timezone: "America/Sao_Paulo"}
	if w.Open(utc) {
		t.Fatal("09:00 em São Paulo não deveria estar aberto para janela 10–18")
	}
}

func TestBatchSize(t *testing.T) {
	// Throttle é por minuto; o lote é por tick. Nunca menos de 1, senão a fila
	// trava com throttle baixo e tick curto.
	cases := []struct {
		throttle int
		tick     time.Duration
		want     int
	}{
		{600, time.Second, 10},
		{60, time.Second, 1},
		{0, time.Second, 1},
		{-5, time.Second, 1},
		{120, 2 * time.Second, 4},
	}
	for _, tc := range cases {
		w := Window{Throttle: tc.throttle}
		if got := w.BatchSize(tc.tick); got != tc.want {
			t.Fatalf("BatchSize(throttle=%d, tick=%s) = %d, esperava %d", tc.throttle, tc.tick, got, tc.want)
		}
	}
}

func TestNextOpen(t *testing.T) {
	w := Window{Start: 9, End: 18, Days: []int{1, 2, 3, 4, 5}, Timezone: "America/Sao_Paulo"}
	// Sábado 10h: a janela abre segunda 9h.
	got := w.NextOpen(at(t, "2006-01-02 15:04", "2026-10-17 10:00"))
	if !w.Open(got) {
		t.Fatalf("NextOpen devolveu %s, que não está aberto", got)
	}
	if got.Weekday() != time.Monday || got.Hour() != 9 {
		t.Fatalf("esperava segunda 9h, veio %s", got)
	}
	// Cedo na segunda: abre no mesmo dia às 9h.
	got = w.NextOpen(at(t, "2006-01-02 15:04", "2026-10-19 07:00"))
	if got.Hour() != 9 || got.Day() != 19 {
		t.Fatalf("esperava 19/10 09:00, veio %s", got)
	}
}
