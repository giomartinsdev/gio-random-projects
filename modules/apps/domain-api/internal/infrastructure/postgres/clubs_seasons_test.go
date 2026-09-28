package postgres

import (
	"testing"
	"time"

	domainclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/clubs"
)

// A fonte NÃO tem noção de temporada: o `season_id` que ela manda nas partidas
// é sempre "0" (medido em produção). Então "temporada" aqui é derivada da
// data: a temporada de futebol europeu começa em julho e termina em junho, e é
// rotulada "AAAA/AA". Este teste fixa essa regra -- é o que impede alguém de
// "consertar" o rótulo para ano-calendário e trocar a semântica sem perceber.
func TestSeasonLabelSplitsOnJuly(t *testing.T) {
	cases := []struct {
		when time.Time
		want string
	}{
		{time.Date(2026, 9, 19, 14, 0, 0, 0, time.UTC), "2026/27"}, // início de temporada
		{time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC), "2026/27"},  // primeiro dia
		{time.Date(2026, 6, 30, 23, 59, 59, 0, time.UTC), "2025/26"}, // último dia da anterior
		{time.Date(2027, 3, 15, 12, 0, 0, 0, time.UTC), "2026/27"}, // meio de temporada
		{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "2025/26"},   // virada do ano civil não vira temporada
	}
	for _, c := range cases {
		if got := seasonLabel(c.when); got != c.want {
			t.Errorf("seasonLabel(%s) = %q; want %q", c.when.Format("2006-01-02"), got, c.want)
		}
	}
}

// seasonsOf agrega os gols por temporada a partir das partidas gravadas, em
// ordem cronológica (mais antiga primeiro) para o gráfico ler da esquerda para
// a direita.
func TestSeasonsOfAggregatesBySeason(t *testing.T) {
	rows := []playerRow{
		mkRow("2026-09-20", 2, 1, 8.0),
		mkRow("2026-09-25", 1, 0, 7.0),
		mkRow("2027-02-10", 3, 2, 9.0),
		mkRow("2026-05-01", 1, 1, 6.0), // temporada anterior
	}

	got := seasonsOf(rows)

	// Set/2026 e fev/2027 são a MESMA temporada (2026/27); maio/2026 é a
	// anterior. São duas, não três -- é o que a virada em julho garante.
	if len(got) != 2 {
		t.Fatalf("temporadas = %d; want 2 (%+v)", len(got), got)
	}
	// Ordem cronológica: 2025/26 (maio/2026), depois 2026/27 (set/2026+fev/2027).
	if got[0].Season != "2025/26" || got[1].Season != "2026/27" {
		t.Fatalf("ordem = %q,%q; want 2025/26,2026/27", got[0].Season, got[1].Season)
	}
	if got[1].Played != 3 || got[1].Goals != 6 || got[1].Assists != 3 {
		t.Errorf("2026/27 = %dJ %dG %dA; want 3J 6G 3A", got[1].Played, got[1].Goals, got[1].Assists)
	}
	if want := 8.0; got[1].Rating != want {
		t.Errorf("2026/27 rating = %v; want %v", got[1].Rating, want)
	}
}

// Sem partidas não há temporada: a lista vazia é o estado certo, não uma
// temporada fantasma com zeros.
func TestSeasonsOfEmptyIsEmpty(t *testing.T) {
	if got := seasonsOf(nil); len(got) != 0 {
		t.Fatalf("seasonsOf(nil) = %+v; want vazio", got)
	}
}

func mkRow(date string, goals, assists int, rating float64) playerRow {
	ts, _ := time.Parse("2006-01-02", date)
	var r playerRow
	r.line.Goals = goals
	r.line.Assists = assists
	r.line.Rating = rating
	r.match.Timestamp = ts
	_ = domainclubs.PlayerLine{}
	return r
}

// A temporada que ainda está em curso é a ÚLTIMA da lista -- o gráfico e a UI
// tratam "temporada atual" como o fim da série.
func TestSeasonsOfCurrentSeasonIsLast(t *testing.T) {
	now := time.Now().UTC()
	rows := []playerRow{
		mkRow(now.AddDate(0, -14, 0).Format("2006-01-02"), 1, 0, 7.0), // ~2 temporadas atrás
		mkRow(now.AddDate(0, -1, 0).Format("2006-01-02"), 2, 1, 8.0),  // temporada atual
	}
	got := seasonsOf(rows)
	if len(got) < 2 {
		t.Fatalf("temporadas = %d; want >= 2", len(got))
	}
	if last := got[len(got)-1]; last.Season != seasonLabel(now) {
		t.Errorf("última temporada = %q; want a atual %q", last.Season, seasonLabel(now))
	}
}
