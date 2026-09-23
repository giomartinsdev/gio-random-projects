package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	domainsnapshot "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/clubsnapshot"
	domainmatch "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/match"
	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preference"
)

// Integration tests against a real Postgres — opt-in via TEST_DATABASE_URL,
// same convention as deal_repository_test.go (unset just skips). Needs the
// schema applied first:
//
//	TEST_DATABASE_URL=postgres://... go test ./internal/infrastructure/postgres/ -run TestPartida
func clubsTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping clubs repository tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return pool
}

// TestPartidaUpsertIsIdempotentByMatchID is the assertion that proves a match
// played between two followed clubs exists exactly once: the second write is an
// update, and the squad lines are replaced rather than duplicated.
func TestPartidaUpsertIsIdempotentByMatchID(t *testing.T) {
	pool := clubsTestPool(t)
	ctx := context.Background()
	repo := NewPartidaRepository(pool)

	matchID := "test-match-" + time.Now().Format("150405.000000000")
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM clubs_matches WHERE match_id = $1`, matchID) })

	p, err := domainmatch.New(matchID, "T1", "T2", domainmatch.TipoLiga, domainmatch.ResultadoVitoria, time.Now().UTC())
	if err != nil {
		t.Fatalf("new partida: %v", err)
	}
	p.HomeGoals, p.AwayGoals = 3, 1

	lines := []domainmatch.LinhaPartida{
		{ClubID: "T1", PlayerID: "p1", Gamertag: "a", Position: "atacante", Rating: 8.1, Goals: 2},
		{ClubID: "T2", PlayerID: "p2", Gamertag: "b", Position: "goalkeeper", Rating: 6.0},
	}

	inserted, err := repo.UpsertByMatchID(ctx, p, lines)
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if !inserted {
		t.Fatal("first upsert must report inserted")
	}

	// The second club's view of the same match: same match_id, so it updates.
	inserted, err = repo.UpsertByMatchID(ctx, p, lines)
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if inserted {
		t.Fatal("second upsert of the same match_id must NOT report inserted")
	}

	got, gotLines, err := repo.FindByMatchID(ctx, matchID)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.HomeGoals != 3 || got.AwayGoals != 1 {
		t.Fatalf("score drifted: %d-%d", got.HomeGoals, got.AwayGoals)
	}
	// Idempotency must extend to the lines: replaced, not appended.
	if len(gotLines) != len(lines) {
		t.Fatalf("squad lines duplicated: want %d, got %d", len(lines), len(gotLines))
	}
}

// TestSnapshotDiffRaisesDivisionChange covers the mechanism that makes the whole
// product possible: the source keeps no history, so a promotion is only ever
// known by diffing two readings.
func TestSnapshotDiffRaisesDivisionChange(t *testing.T) {
	pool := clubsTestPool(t)
	ctx := context.Background()
	repo := NewClubSnapshotRepository(pool)

	clubID := "test-snap-" + time.Now().Format("150405.000000000")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_snapshots WHERE club_id = $1`, clubID)
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_division_changes WHERE club_id = $1`, clubID)
	})

	first, err := domainsnapshot.New(clubID, time.Now().UTC())
	if err != nil {
		t.Fatalf("new snapshot: %v", err)
	}
	first.DivisionAtRead, first.SkillRating = 5, 1200
	change, err := repo.Append(ctx, first)
	if err != nil {
		t.Fatalf("first append: %v", err)
	}
	if change != nil {
		t.Fatal("the first reading has nothing to diff against; no change expected")
	}

	// Division 5 -> 4 is a promotion (1 is the top).
	second, _ := domainsnapshot.New(clubID, time.Now().UTC().Add(time.Hour))
	second.DivisionAtRead, second.SkillRating = 4, 1330
	change, err = repo.Append(ctx, second)
	if err != nil {
		t.Fatalf("second append: %v", err)
	}
	if change == nil {
		t.Fatal("a division move must raise a change")
	}
	if change.Kind != domainsnapshot.TipoPromocao {
		t.Fatalf("want promoção, got %q", change.Kind)
	}

	// And it must be readable back, which is what the API serves.
	changes, err := repo.Changes(ctx, clubID)
	if err != nil {
		t.Fatalf("changes: %v", err)
	}
	if len(changes) != 1 {
		t.Fatalf("want 1 recorded change, got %d", len(changes))
	}

	// A third reading in the same division raises nothing.
	third, _ := domainsnapshot.New(clubID, time.Now().UTC().Add(2*time.Hour))
	third.DivisionAtRead, third.SkillRating = 4, 1350
	if change, err = repo.Append(ctx, third); err != nil {
		t.Fatalf("third append: %v", err)
	}
	if change != nil {
		t.Fatal("no division move means no change event")
	}
}

// TestPreferenciaIsScopedByUsuario is the assertion that proves one person's
// watchlist never appears for another — the only requirement whose failure is a
// privacy incident rather than a UI bug.
func TestPreferenciaIsScopedByUsuario(t *testing.T) {
	pool := clubsTestPool(t)
	ctx := context.Background()
	repo := NewPreferenciaRepository(pool)

	alice := "alice-" + time.Now().Format("150405.000000000") + "@test"
	bob := "bob-" + time.Now().Format("150405.000000000") + "@test"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM clubs_watchlist WHERE user_email IN ($1,$2)`, alice, bob)
	})

	entry, err := domainpref.NewWatch(alice, "T1", domainpref.OrigemProprio)
	if err != nil {
		t.Fatalf("new watch: %v", err)
	}
	if err := repo.SetWatchWithOrigem(ctx, entry); err != nil {
		t.Fatalf("set watch: %v", err)
	}

	bobsList, err := repo.ListWatch(ctx, bob)
	if err != nil {
		t.Fatalf("list bob: %v", err)
	}
	if len(bobsList) != 0 {
		t.Fatalf("isolation broken: bob sees %d entries", len(bobsList))
	}

	alicesList, err := repo.ListWatch(ctx, alice)
	if err != nil {
		t.Fatalf("list alice: %v", err)
	}
	if len(alicesList) != 1 {
		t.Fatalf("alice should see her own follow, got %d", len(alicesList))
	}
}
