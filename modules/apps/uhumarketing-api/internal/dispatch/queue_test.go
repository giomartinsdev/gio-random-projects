package dispatch

import (
	"testing"
	"time"
)

// ExplainQueue existe para a tela poder dizer POR QUE nada saiu. Um teste aqui
// vale mais que um comentário: se a explicação mentir, o operador vai procurar
// bug no lugar errado.
func TestExplainQueue(t *testing.T) {
	loc, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatalf("fuso: %v", err)
	}
	// Segunda-feira, 22:00 em São Paulo — fora da janela comercial.
	now := time.Date(2026, 10, 19, 22, 0, 0, 0, loc)

	cases := []struct {
		name       string
		window     Window
		queued     int
		wantBlock  string
		wantNextAt string
	}{
		{
			name:       "fora da janela explica quando abre",
			window:     Window{Start: 9, End: 18, Timezone: "America/Sao_Paulo"},
			queued:     29,
			wantBlock:  "window",
			wantNextAt: "2026-10-20 09:00",
		},
		{
			name:      "fila vazia não está bloqueada",
			window:    Window{Start: 9, End: 18, Timezone: "America/Sao_Paulo"},
			queued:    0,
			wantBlock: "empty",
		},
		{
			name:      "dentro da janela, fila pode andar",
			window:    Window{Start: 0, End: 23, Timezone: "America/Sao_Paulo"},
			queued:    5,
			wantBlock: "",
		},
		{
			name:      "sem restrição declarada nunca bloqueia",
			window:    Window{Timezone: "America/Sao_Paulo"},
			queued:    5,
			wantBlock: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ExplainQueue(now, "cmp_x", tc.window, tc.queued)
			if got.BlockedBy != tc.wantBlock {
				t.Fatalf("blockedBy = %q, esperava %q", got.BlockedBy, tc.wantBlock)
			}
			if tc.wantNextAt != "" {
				if got.NextOpenAt.In(loc).Format("2006-01-02 15:04") != tc.wantNextAt {
					t.Fatalf("nextOpenAt = %s, esperava %s", got.NextOpenAt.In(loc), tc.wantNextAt)
				}
			}
		})
	}
}
