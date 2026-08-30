package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/deal"
)

// DealRepository implements domain/deal.Repository — read-only,
// matching what domain-api actually does with it (the writes happen in
// domain-worker; both apps carry the same raw_deals DDL in schema.sql).
type DealRepository struct {
	pool *pgxpool.Pool
}

func NewDealRepository(pool *pgxpool.Pool) *DealRepository {
	return &DealRepository{pool: pool}
}

const dealColumns = `source, source_deal_id, title, url, store, price_cents, old_price_cents, posted_at, scraped_at, payload`

func scanDeal(row pgx.Row) (domaindeal.Deal, error) {
	var d domaindeal.Deal
	err := row.Scan(
		&d.Source, &d.SourceDealID, &d.Title, &d.URL, &d.Store,
		&d.PriceCents, &d.OldPriceCents, &d.PostedAt, &d.ScrapedAt, &d.Payload,
	)
	return d, err
}

func (r *DealRepository) FindByKey(ctx context.Context, source, sourceDealID string) (domaindeal.Deal, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+dealColumns+` FROM raw_deals WHERE source = $1 AND source_deal_id = $2`,
		source, sourceDealID,
	)
	d, err := scanDeal(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domaindeal.Deal{}, domaindeal.ErrNotFound
	}
	if err != nil {
		return domaindeal.Deal{}, fmt.Errorf("find deal: %w", err)
	}
	return d, nil
}

// An empty source means "every source" — the filter collapses out
// rather than needing a second query string.
func (r *DealRepository) ListRecent(ctx context.Context, source string, limit int) ([]domaindeal.Deal, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+dealColumns+` FROM raw_deals
		 WHERE ($1 = '' OR source = $1)
		 ORDER BY posted_at DESC NULLS LAST, scraped_at DESC
		 LIMIT $2`,
		source, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list deals: %w", err)
	}
	defer rows.Close()

	var deals []domaindeal.Deal
	for rows.Next() {
		d, err := scanDeal(rows)
		if err != nil {
			return nil, fmt.Errorf("scan deal: %w", err)
		}
		deals = append(deals, d)
	}
	return deals, rows.Err()
}