package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	domainclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/clubs"
)

// ClubDeltas: "o que mudou desde que comecei a acompanhar". Só existe porque o
// hub acumula leituras -- a fonte não sabe responder isso. Estes testes usam
// Postgres REAL (testcontainers), com o schema do worker, porque a regra é a
// comparação entre a primeira e a última leitura, e isso é uma consulta.
func TestClubDeltasComparaPrimeiraEUltimaLeitura(t *testing.T) {
	pool := readPool(t)
	repo := NewClubsRepository(pool)
	clubID := "delta-test-club"
	base := time.Now().UTC().Add(-30 * 24 * time.Hour)

	seedSnapshots(t, pool, clubID, []snapshotRow{
		{at: base, skill: 2000, division: 2, played: 100, wins: 60, draws: 10, losses: 30, goals: 400},
		{at: base.Add(10 * 24 * time.Hour), skill: 2100, division: 2, played: 150, wins: 90, draws: 15, losses: 45, goals: 600},
		{at: base.Add(20 * 24 * time.Hour), skill: 2250, division: 1, played: 200, wins: 130, draws: 20, losses: 50, goals: 850},
	})

	got, err := repo.ClubDeltas(context.Background(), clubID)
	if err != nil {
		t.Fatalf("club deltas: %v", err)
	}

	if got.Matches != 100 {
		t.Errorf("matches = %d; want 100", got.Matches)
	}
	if got.Wins != 70 {
		t.Errorf("wins = %d; want 70", got.Wins)
	}
	if got.Goals != 450 {
		t.Errorf("goals = %d; want 450", got.Goals)
	}
	if got.SkillDelta != 250 {
		t.Errorf("skill_delta = %d; want 250", got.SkillDelta)
	}
	if got.DivisionFrom != 2 || got.DivisionTo != 1 {
		t.Errorf("divisão %d -> %d; want 2 -> 1", got.DivisionFrom, got.DivisionTo)
	}
}

// Sem histórico, o delta é zerado -- "ainda não acompanhamos o suficiente", não
// erro. Uma consulta que estoura aqui derrubaria o perfil de um clube novo.
func TestClubDeltasSemHistoricoNaoEhErro(t *testing.T) {
	pool := readPool(t)
	repo := NewClubsRepository(pool)

	got, err := repo.ClubDeltas(context.Background(), "clube-nunca-visto")
	if err != nil {
		t.Fatalf("sem histórico não é erro: %v", err)
	}
	if got.Matches != 0 || !got.Since.IsZero() {
		t.Errorf("esperava delta zerado; veio %+v", got)
	}
}

// A linha do tempo inclui o evento de divisão registrado e a entrada no hub
// (primeira leitura), em ordem decrescente. É o acervo que a fonte não tem.
func TestTimelineIncluiDivisaoEEntradaNoHub(t *testing.T) {
	pool := readPool(t)
	repo := NewClubsRepository(pool)
	ctx := context.Background()
	clubID := "timeline-test-club"
	base := time.Now().UTC().Add(-40 * 24 * time.Hour)

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_snapshots WHERE club_id = $1`, clubID)
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_division_changes WHERE club_id = $1`, clubID)
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_matches WHERE home_club_id = $1 OR away_club_id = $1`, clubID)
	})

	seedSnapshots(t, pool, clubID, []snapshotRow{
		{at: base, skill: 2000, division: 2, played: 100, wins: 60, draws: 10, losses: 30, goals: 400},
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO clubs_division_changes (id, club_id, detected_at, previous_division, new_division, kind)
		VALUES ($1,$2,$3,2,1,'promotion')`, uuid.NewString(), clubID, base.Add(20*24*time.Hour)); err != nil {
		t.Fatalf("seed divisão: %v", err)
	}

	got, err := repo.Timeline(ctx, clubID)
	if err != nil {
		t.Fatalf("timeline: %v", err)
	}
	if len(got) < 2 {
		t.Fatalf("timeline = %d eventos; want >= 2 (%+v)", len(got), got)
	}

	kinds := map[string]bool{}
	for _, e := range got {
		kinds[e.Kind] = true
	}
	if !kinds["divisao"] {
		t.Error("a linha do tempo precisa do evento de divisão")
	}
	if !kinds["seguido"] {
		t.Error("a linha do tempo precisa da entrada no hub (primeira leitura)")
	}

	// Ordenada da mais recente para a mais antiga: a divisão (dia 20) vem antes
	// da entrada no hub (dia 0).
	if !got[0].At.After(got[len(got)-1].At) {
		t.Errorf("timeline fora de ordem: primeiro %s, último %s", got[0].At, got[len(got)-1].At)
	}
}

// O evento de divisão carrega os FATOS (divisão anterior e nova), para a UI
// montar a frase no idioma escolhido -- como no feed.
func TestTimelineDivisaoCarregaOsFatos(t *testing.T) {
	pool := readPool(t)
	repo := NewClubsRepository(pool)
	ctx := context.Background()
	clubID := "timeline-fatos"
	base := time.Now().UTC().Add(-5 * 24 * time.Hour)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_division_changes WHERE club_id = $1`, clubID)
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_snapshots WHERE club_id = $1`, clubID)
	})
	seedSnapshots(t, pool, clubID, []snapshotRow{{at: base, skill: 2000, division: 2, played: 1, goals: 1}})
	_, _ = pool.Exec(ctx, `
		INSERT INTO clubs_division_changes (id, club_id, detected_at, previous_division, new_division, kind)
		VALUES ($1,$2,$3,3,2,'promotion')`, uuid.NewString(), clubID, base)

	got, _ := repo.Timeline(ctx, clubID)
	var div *domainclubs.TimelineEntry
	for i := range got {
		if got[i].Kind == "divisao" {
			div = &got[i]
		}
	}
	if div == nil {
		t.Fatal("esperava evento de divisão")
	}
	if div.Data["previous_division"] != 3 || div.Data["new_division"] != 2 {
		t.Errorf("fatos da divisão errados: %+v", div.Data)
	}
}
