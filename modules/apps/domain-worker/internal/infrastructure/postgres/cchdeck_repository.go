package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domaincchdeck "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/cchdeck"
)

// CCHDeckRepository implements domain/cchdeck.Repository against
// Postgres — the Forja's deck marketplace, written through the command
// pipeline instead of living in a JSON file on the container volume.
type CCHDeckRepository struct {
	pool *pgxpool.Pool
}

func NewCCHDeckRepository(pool *pgxpool.Pool) *CCHDeckRepository {
	return &CCHDeckRepository{pool: pool}
}

// Upsert writes the deck whole. ON CONFLICT DO UPDATE, not DO NOTHING:
// the plays bump arrives as a whole record too, so a DO NOTHING would
// silently freeze every play count at whatever the first publish
// wrote. Every column is EXCLUDED, so a replay of any historical
// command converges on that command's own snapshot — same trade the
// caller made when it rewrote its whole JSON file per write.
func (r *CCHDeckRepository) Upsert(ctx context.Context, deck domaincchdeck.Deck) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO cch_custom_decks (id, name, emoji, description, parent_id, author, whites, blacks, created_at, plays)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 ON CONFLICT (id) DO UPDATE SET
		   name        = EXCLUDED.name,
		   emoji       = EXCLUDED.emoji,
		   description = EXCLUDED.description,
		   parent_id   = EXCLUDED.parent_id,
		   author      = EXCLUDED.author,
		   whites      = EXCLUDED.whites,
		   blacks      = EXCLUDED.blacks,
		   created_at  = EXCLUDED.created_at,
		   plays       = EXCLUDED.plays`,
		deck.ID, deck.Name, deck.Emoji, deck.Description, deck.ParentID,
		deck.Author, deck.Whites, deck.Blacks, deck.CreatedAt, deck.Plays,
	)
	if err != nil {
		return fmt.Errorf("upsert cch deck: %w", err)
	}
	return nil
}

// IncrementPlays is the atomic side of the play count: the increment
// lives in the UPDATE, so two bumps racing (each in its own command)
// both land instead of the later one overwriting the earlier.
func (r *CCHDeckRepository) IncrementPlays(ctx context.Context, id string) (int, error) {
	var plays int
	err := r.pool.QueryRow(ctx,
		`UPDATE cch_custom_decks SET plays = plays + 1 WHERE id = $1 RETURNING plays`, id).
		Scan(&plays)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("cch deck %q: %w", id, domaincchdeck.ErrIDRequired)
	}
	if err != nil {
		return 0, fmt.Errorf("increment plays for cch deck %s: %w", id, err)
	}
	return plays, nil
}