// Package clubetotais is the domain layer for the ClubeTotais aggregate —
// the all-time totals the source returns even for a club the hub does not
// follow. Separate from Club because it exists precisely for clubs that
// will never have a squad or matches, and because its shape changes far
// less often.
package clubetotais

import "time"

type Totais struct {
	ClubID         string
	Jogos          int
	Vitorias       int
	Empates        int
	Derrotas       int
	Gols           int
	GolsSofridos   int
	JogosSemSofrer int
	Pontos         int
	DivisaoAtual   int
	MelhorDivisao  int
	Nivel          int
	Promocoes      int
	Rebaixamentos  int
	LidoEm         time.Time
}
