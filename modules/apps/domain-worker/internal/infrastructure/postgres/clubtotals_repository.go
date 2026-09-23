package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainclubtotals "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/clubtotals"
)

// ClubeTotaisRepository implements domain/clubetotais.Repository.
type ClubeTotaisRepository struct {
	pool *pgxpool.Pool
}

func NewClubeTotaisRepository(pool *pgxpool.Pool) *ClubeTotaisRepository {
	return &ClubeTotaisRepository{pool: pool}
}

const totaisColumns = `club_id, played, wins, draws, losses, goals, goals_conceded,
	clean_sheets, points, division, best_division, skill_rating, promotions, relegations, read_at`

func scanTotais(row pgx.Row) (domainclubtotals.Totais, error) {
	var t domainclubtotals.Totais
	err := row.Scan(
		&t.ClubID, &t.Played, &t.Wins, &t.Draws, &t.Losses, &t.Goals, &t.GoalsConceded,
		&t.CleanSheets, &t.Points, &t.Division, &t.BestDivision, &t.SkillRating,
		&t.Promotions, &t.Relegations, &t.ReadAt,
	)
	return t, err
}

func (r *ClubeTotaisRepository) FindByClub(ctx context.Context, clubID string) (domainclubtotals.Totais, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+totaisColumns+` FROM clubs_totais WHERE club_id = $1`, clubID)
	t, err := scanTotais(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainclubtotals.Totais{}, domainclubtotals.ErrNotFound
	}
	if err != nil {
		return domainclubtotals.Totais{}, fmt.Errorf("find clube totais: %w", err)
	}
	return t, nil
}

const totaisUpsert = `
	INSERT INTO clubs_totais (club_id, played, wins, draws, losses, goals, goals_conceded,
		clean_sheets, points, division, best_division, skill_rating, promotions, relegations, read_at)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
	ON CONFLICT (club_id) DO UPDATE SET
		played = EXCLUDED.played, wins = EXCLUDED.wins, draws = EXCLUDED.draws,
		losses = EXCLUDED.losses, goals = EXCLUDED.goals, goals_conceded = EXCLUDED.goals_conceded,
		clean_sheets = EXCLUDED.clean_sheets, points = EXCLUDED.points,
		division = EXCLUDED.division, best_division = EXCLUDED.best_division,
		skill_rating = EXCLUDED.skill_rating, promotions = EXCLUDED.promotions, relegations = EXCLUDED.relegations,
		read_at = now()`

func (r *ClubeTotaisRepository) Upsert(ctx context.Context, t domainclubtotals.Totais) error {
	_, err := r.pool.Exec(ctx, totaisUpsert,
		t.ClubID, t.Played, t.Wins, t.Draws, t.Losses, t.Goals, t.GoalsConceded,
		t.CleanSheets, t.Points, t.Division, t.BestDivision, t.SkillRating,
		t.Promotions, t.Relegations)
	if err != nil {
		return fmt.Errorf("upsert clube totais: %w", err)
	}
	return nil
}

// UpsertMany writes a whole search page in one transaction — a broad search
// returning dozens of clubs should not cost dozens of round-trips.
func (r *ClubeTotaisRepository) UpsertMany(ctx context.Context, list []domainclubtotals.Totais) error {
	if len(list) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin totais tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, t := range list {
		if _, err := tx.Exec(ctx, totaisUpsert,
			t.ClubID, t.Played, t.Wins, t.Draws, t.Losses, t.Goals, t.GoalsConceded,
			t.CleanSheets, t.Points, t.Division, t.BestDivision, t.SkillRating,
			t.Promotions, t.Relegations); err != nil {
			return fmt.Errorf("upsert clube totais %s: %w", t.ClubID, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit totais tx: %w", err)
	}
	return nil
}

// ListAll returns every club's totals — the global ranking's raw material.
func (r *ClubeTotaisRepository) ListAll(ctx context.Context) ([]domainclubtotals.Totais, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+totaisColumns+` FROM clubs_totais`)
	if err != nil {
		return nil, fmt.Errorf("list totais: %w", err)
	}
	defer rows.Close()

	var list []domainclubtotals.Totais
	for rows.Next() {
		t, err := scanTotais(rows)
		if err != nil {
			return nil, fmt.Errorf("scan totais: %w", err)
		}
		list = append(list, t)
	}
	return list, rows.Err()
}
