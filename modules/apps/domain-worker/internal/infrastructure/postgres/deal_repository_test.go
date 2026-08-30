package postgres

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/deal"
)

// Integration test against a real Postgres — opt-in via
// TEST_DATABASE_URL (CI has no Postgres service for this module, so
// unset just skips it). Needs the schema applied first, e.g.:
//
//	TEST_DATABASE_URL=postgres://... go test ./internal/infrastructure/postgres/ -run TestDealRepository
func TestDealRepositoryUpsertReportsInserts(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping raw_deals repository test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	if err := Migrate(ctx, pool); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	key := "test-" + time.Now().Format("150405.000000000")
	d := domaindeal.Deal{
		Source:       "test",
		SourceDealID: key,
		Title:        "repo test deal",
		URL:          "https://example.com/deal",
		PriceCents:   intPtr(1234),
		ScrapedAt:    time.Now().UTC(),
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM raw_deals WHERE source = 'test' AND source_deal_id = $1`, key)
	})

	repo := NewDealRepository(pool)

	inserted, err := repo.Upsert(ctx, d)
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if !inserted {
		t.Fatal("first upsert must report inserted")
	}

	posted := time.Now().UTC().Add(-time.Hour)
	d.PostedAt = &posted
	inserted, err = repo.Upsert(ctx, d)
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if inserted {
		t.Fatal("replayed upsert must not report inserted")
	}

	var stored time.Time
	if err := pool.QueryRow(ctx,
		`SELECT posted_at FROM raw_deals WHERE source = 'test' AND source_deal_id = $1`, key,
	).Scan(&stored); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !stored.Equal(posted) {
		t.Fatalf("posted_at = %v, want first-seen %v", stored, posted)
	}
}

func intPtr(i int) *int { return &i }
