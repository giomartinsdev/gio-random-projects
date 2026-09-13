package ai

import "testing"

func TestParseExtracao(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    Extracao
		wantErr bool
	}{
		{
			name:    "clean json",
			content: `{"casa":"Bet365","descricao":"Real Madrid vence","valorApostado":50,"odd":1.8}`,
			want:    Extracao{Casa: "Bet365", Descricao: "Real Madrid vence", ValorApostado: 50, Odd: 1.8},
		},
		{
			name:    "wrapped in prose and markdown fences",
			content: "Aqui está o resultado:\n```json\n{\"casa\":\"Betano\",\"descricao\":\"Over 2.5\",\"valorApostado\":20,\"odd\":0}\n```\nEspero ter ajudado!",
			want:    Extracao{Casa: "Betano", Descricao: "Over 2.5", ValorApostado: 20, Odd: 0},
		},
		{
			name:    "no json at all",
			content: "não consegui ler a imagem",
			wantErr: true,
		},
		{
			name:    "malformed json",
			content: `{"casa": "Bet365", "valorApostado": }`,
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseExtracao(tc.content)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %+v", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}
