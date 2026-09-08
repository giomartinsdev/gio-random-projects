package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	domaincchdeck "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/cchdeck"
)

// CCHDeckRepository implements domain/cchdeck.Repository — read-only,
// matching what domain-api actually does with it: cch-api's boot load
// of the Forja's deck marketplace (cards included; this is the
// server-to-server path, not the browser-facing listing). The write
// side lives in domain-worker.
type CCHDeckRepository struct {
	pool *pgxpool.Pool
}

func NewCCHDeckRepository(pool *pgxpool.Pool) *CCHDeckRepository {
	return &CCHDeckRepository{pool: pool}
}

func (r *CCHDeckRepository) List(ctx context.Context) ([]domaincchdeck.Deck, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, name, emoji, description, parent_id, author, whites, blacks, created_at, plays
		 FROM cch_custom_decks ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list cch decks: %w", err)
	}
	defer rows.Close()

	var decks []domaincchdeck.Deck
	for rows.Next() {
		var deck domaincchdeck.Deck
		if err := rows.Scan(&deck.ID, &deck.Name, &deck.Emoji, &deck.Description, &deck.ParentID,
			&deck.Author, &deck.Whites, &deck.Blacks, &deck.CreatedAt, &deck.Plays); err != nil {
			return nil, fmt.Errorf("scan cch deck: %w", err)
		}
		decks = append(decks, deck)
	}
	return decks, rows.Err()
}