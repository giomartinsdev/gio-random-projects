package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainclub "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/club"
)

// ClubRepository implements domain/club.Repository against Postgres.
type ClubRepository struct {
	pool *pgxpool.Pool
}

func NewClubRepository(pool *pgxpool.Pool) *ClubRepository {
	return &ClubRepository{pool: pool}
}

const clubColumns = `club_id, name, tag, stadium, region_id, team_id, crest_asset_id, color_1, color_2, color_3, color_4, tracked, updated_at`

func scanClub(row pgx.Row) (domainclub.Club, error) {
	var c domainclub.Club
	err := row.Scan(
		&c.ClubID, &c.Name, &c.Tag, &c.Stadium, &c.RegiaoID, &c.TimeID,
		&c.EscudoAssetID, &c.Color1, &c.Color2, &c.Color3, &c.Color4, &c.Tracked, &c.UpdatedAt,
	)
	return c, err
}

func (r *ClubRepository) FindByID(ctx context.Context, clubID string) (domainclub.Club, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+clubColumns+` FROM clubs WHERE club_id = $1`, clubID)
	c, err := scanClub(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainclub.Club{}, domainclub.ErrNotFound
	}
	if err != nil {
		return domainclub.Club{}, fmt.Errorf("find club: %w", err)
	}
	return c, nil
}

func (r *ClubRepository) ListAcompanhados(ctx context.Context) ([]domainclub.Club, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+clubColumns+` FROM clubs WHERE tracked = true ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list acompanhados: %w", err)
	}
	defer rows.Close()

	var list []domainclub.Club
	for rows.Next() {
		c, err := scanClub(rows)
		if err != nil {
			return nil, fmt.Errorf("scan club: %w", err)
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

// Upsert inserts the club on first sight and updates it afterwards, keyed by
// club_id. It never overwrites `acompanhado` with false — a club that has
// ever been fetched keeps that status even if a later search only returns
// its totals, because the squad and matches are still on disk.
func (r *ClubRepository) Upsert(ctx context.Context, c domainclub.Club) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs (club_id, name, tag, stadium, region_id, team_id, crest_asset_id,
		                   color_1, color_2, color_3, color_4, tracked, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
		ON CONFLICT (club_id) DO UPDATE SET
			name            = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE clubs.name END,
			tag           = CASE WHEN EXCLUDED.tag <> '' THEN EXCLUDED.tag ELSE clubs.tag END,
			stadium         = CASE WHEN EXCLUDED.stadium <> '' THEN EXCLUDED.stadium ELSE clubs.stadium END,
			region_id       = CASE WHEN EXCLUDED.region_id <> '' THEN EXCLUDED.region_id ELSE clubs.region_id END,
			team_id         = CASE WHEN EXCLUDED.team_id <> '' THEN EXCLUDED.team_id ELSE clubs.team_id END,
			crest_asset_id = CASE WHEN EXCLUDED.crest_asset_id <> '' THEN EXCLUDED.crest_asset_id ELSE clubs.crest_asset_id END,
			color_1           = CASE WHEN EXCLUDED.color_1 <> 0 THEN EXCLUDED.color_1 ELSE clubs.color_1 END,
			color_2           = CASE WHEN EXCLUDED.color_2 <> 0 THEN EXCLUDED.color_2 ELSE clubs.color_2 END,
			color_3           = CASE WHEN EXCLUDED.color_3 <> 0 THEN EXCLUDED.color_3 ELSE clubs.color_3 END,
			color_4           = CASE WHEN EXCLUDED.color_4 <> 0 THEN EXCLUDED.color_4 ELSE clubs.color_4 END,
			tracked     = clubs.tracked OR EXCLUDED.tracked,
			updated_at   = now()
	`, c.ClubID, c.Name, c.Tag, c.Stadium, c.RegiaoID, c.TimeID, c.EscudoAssetID,
		c.Color1, c.Color2, c.Color3, c.Color4, c.Tracked)
	if err != nil {
		return fmt.Errorf("upsert club: %w", err)
	}
	return nil
}

func (r *ClubRepository) SetAcompanhado(ctx context.Context, clubID string, tracked bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE clubs SET tracked = $2, updated_at = now() WHERE club_id = $1`,
		clubID, tracked)
	if err != nil {
		return fmt.Errorf("set tracked: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainclub.ErrNotFound
	}
	return nil
}

// ListAll returns every known club, followed or not — the admin view and
// the global ranking both need the known universe, not just the followed
// subset.
func (r *ClubRepository) ListAll(ctx context.Context) ([]domainclub.Club, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+clubColumns+` FROM clubs ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list clubs: %w", err)
	}
	defer rows.Close()

	var list []domainclub.Club
	for rows.Next() {
		c, err := scanClub(rows)
		if err != nil {
			return nil, fmt.Errorf("scan club: %w", err)
		}
		list = append(list, c)
	}
	return list, rows.Err()
}
