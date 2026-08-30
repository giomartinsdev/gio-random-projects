package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"

	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/deal"
)

// DealRepository implements domain/deal.Repository against Postgres.
type DealRepository struct {
	pool *pgxpool.Pool
}

func NewDealRepository(pool *pgxpool.Pool) *DealRepository {
	return &DealRepository{pool: pool}
}

// notNullJSON feeds raw_deals.payload, whose column is NOT NULL —
// a missing payload was already normalized to "{}" upstream, but the
// adapter defends its own SQL anyway (and pgx won't take nil []byte
// for a jsonb NOT NULL column).
func notNullJSON(p []byte) []byte {
	if len(p) == 0 {
		return []byte("{}")
	}
	return p
}

// Upsert writes the deal and reports whether it was a NEW row.
//
// The inserted flag comes straight from Postgres in the same statement
// (RETURNING (xmax = 0) — xmax flips to a new write-tuple id only on
// INSERT), so there is no read-before-write for a concurrent scraper
// to race around. posted_at is deliberately OUTSIDE the DO UPDATE:
// "first seen wins" — a re-poll that finds a slightly different
// posted_at never rewrites when the deal was first published.
func (r *DealRepository) Upsert(ctx context.Context, d domaindeal.Deal) (bool, error) {
	ctx, span := otel.Tracer("domain-worker").Start(ctx, "deal repo upsert")
	defer span.End()

	row := r.pool.QueryRow(ctx, `
		INSERT INTO raw_deals
			(source, source_deal_id, title, url, store, price_cents, old_price_cents,
			 posted_at, scraped_at, payload)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (source, source_deal_id) DO UPDATE SET
			title           = EXCLUDED.title,
			url             = EXCLUDED.url,
			store           = EXCLUDED.store,
			price_cents     = EXCLUDED.price_cents,
			old_price_cents = EXCLUDED.old_price_cents,
			scraped_at      = EXCLUDED.scraped_at,
			payload         = EXCLUDED.payload
		RETURNING (xmax = 0) AS inserted`,
		d.Source, d.SourceDealID, d.Title, d.URL, d.Store, d.PriceCents, d.OldPriceCents,
		d.PostedAt, d.ScrapedAt, notNullJSON(d.Payload),
	)

	var inserted bool
	if err := row.Scan(&inserted); err != nil {
		err = fmt.Errorf("upsert deal: %w", err)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return false, err
	}
	return inserted, nil
}
