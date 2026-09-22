// Package clubesnapshot holds the Command payload for the snapshot append —
// it travels the platform's async 202 path (high volume, append-only, nobody
// waits for the answer).
package clubesnapshot

// AppendInput is the clubesnapshot.append payload.
type AppendInput struct {
	ClubID        string `json:"club_id"`
	Nivel         int    `json:"nivel"`
	Divisao       int    `json:"divisao"`
	Jogos         int    `json:"jogos"`
	Vitorias      int    `json:"vitorias"`
	Empates       int    `json:"empates"`
	Derrotas      int    `json:"derrotas"`
	Gols          int    `json:"gols"`
	GolsSofridos  int    `json:"gols_sofridos"`
	TamanhoElenco int    `json:"tamanho_elenco"`
}
