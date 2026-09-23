package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainmatch "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/match"
)

// PartidaRepository implements domain/partida.Repository against Postgres.
type PartidaRepository struct {
	pool *pgxpool.Pool
}

func NewPartidaRepository(pool *pgxpool.Pool) *PartidaRepository {
	return &PartidaRepository{pool: pool}
}

const partidaColumns = `id, match_id, timestamp, kind, playoff_round, home_club_id, away_club_id,
	home_goals, away_goals, decided_by_forfeit, forfeit_winner_id, home_result, events, created_at`

const linhaColumns = `club_id, player_id, gamertag, position, rating, goals, assists, shots,
	passes_made, passes_attempted, tackles_made, tackles_attempted, saves, saves_by_type,
	seconds_played, man_of_the_match, red_card, clean_sheet`

func scanPartida(row pgx.Row) (domainmatch.Partida, error) {
	var p domainmatch.Partida
	err := row.Scan(
		&p.ID, &p.MatchID, &p.Timestamp, &p.Kind, &p.PlayoffRound, &p.ClubeCasaID, &p.ClubeForaID,
		&p.HomeGoals, &p.AwayGoals, &p.DecidedByForfeit, &p.VencedorPorDesistenciaID, &p.HomeResult,
		&p.Events, &p.CreatedAt,
	)
	return p, err
}

func scanLinha(row pgx.Row) (domainmatch.LinhaPartida, error) {
	var l domainmatch.LinhaPartida
	err := row.Scan(
		&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Position, &l.Rating, &l.Goals, &l.Assists, &l.Shots,
		&l.PassesMade, &l.PassesAttempted, &l.TacklesMade, &l.TacklesAttempted, &l.Saves,
		&l.SavesByType, &l.SecondsPlayed, &l.ManOfTheMatch, &l.RedCard, &l.CleanSheet,
	)
	return l, err
}

// UpsertByMatchID is the method that guarantees a match played between two
// followed clubs exists exactly once: the first write inserts, the second
// updates the same row (the two sides are the same match_id). The squad
// lines are replaced atomically in the same transaction, so a match is
// never left with a partial summary.
func (r *PartidaRepository) UpsertByMatchID(ctx context.Context, p domainmatch.Partida, linhas []domainmatch.LinhaPartida) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin partida tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var existingID string
	err = tx.QueryRow(ctx, `SELECT id FROM clubs_matches WHERE match_id = $1`, p.MatchID).Scan(&existingID)

	inserted := false
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		inserted = true
		p.ID = uuid.NewString()
		if p.CreatedAt.IsZero() {
			p.CreatedAt = time.Now().UTC()
		}
		if len(p.Events) == 0 {
			p.Events = []byte("[]")
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO clubs_matches (id, match_id, timestamp, kind, playoff_round,
				home_club_id, away_club_id, home_goals, away_goals, decided_by_forfeit,
				forfeit_winner_id, home_result, events, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			p.ID, p.MatchID, p.Timestamp, p.Kind, p.PlayoffRound,
			p.ClubeCasaID, p.ClubeForaID, p.HomeGoals, p.AwayGoals, p.DecidedByForfeit,
			p.VencedorPorDesistenciaID, p.HomeResult, p.Events, p.CreatedAt)
		if err != nil {
			return false, fmt.Errorf("insert partida: %w", err)
		}
	case err != nil:
		return false, fmt.Errorf("lookup partida: %w", err)
	default:
		p.ID = existingID
		if len(p.Events) == 0 {
			p.Events = []byte("[]")
		}
		_, err = tx.Exec(ctx, `
			UPDATE clubs_matches SET timestamp = $2, kind = $3, playoff_round = $4,
				home_club_id = $5, away_club_id = $6, home_goals = $7, away_goals = $8,
				decided_by_forfeit = $9, forfeit_winner_id = $10, home_result = $11,
				events = $12
			WHERE match_id = $1`,
			p.MatchID, p.Timestamp, p.Kind, p.PlayoffRound,
			p.ClubeCasaID, p.ClubeForaID, p.HomeGoals, p.AwayGoals, p.DecidedByForfeit,
			p.VencedorPorDesistenciaID, p.HomeResult, p.Events)
		if err != nil {
			return false, fmt.Errorf("update partida: %w", err)
		}
	}

	// Replace the squad lines wholesale: a re-read of the same match is the
	// authority, and (partida_id, player_id) is unique anyway.
	if _, err := tx.Exec(ctx, `DELETE FROM clubs_match_players WHERE match_id_uuid = $1`, p.ID); err != nil {
		return false, fmt.Errorf("clear linhas: %w", err)
	}
	for _, l := range linhas {
		if _, err := tx.Exec(ctx, `
			INSERT INTO clubs_match_players (id, match_id_uuid, club_id, player_id, gamertag, position,
				rating, goals, assists, shots, passes_made, passes_attempted, tackles_made,
				tackles_attempted, saves, saves_by_type, seconds_played, man_of_the_match,
				red_card, clean_sheet)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
			uuid.NewString(), p.ID, l.ClubID, l.PlayerID, l.Gamertag, l.Position,
			l.Rating, l.Goals, l.Assists, l.Shots, l.PassesMade, l.PassesAttempted,
			l.TacklesMade, l.TacklesAttempted, l.Saves, l.SavesByType, l.SecondsPlayed,
			l.ManOfTheMatch, l.RedCard, l.CleanSheet); err != nil {
			return false, fmt.Errorf("insert linha: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit partida tx: %w", err)
	}
	return inserted, nil
}

func (r *PartidaRepository) FindByMatchID(ctx context.Context, matchID string) (domainmatch.Partida, []domainmatch.LinhaPartida, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+partidaColumns+` FROM clubs_matches WHERE match_id = $1`, matchID)
	p, err := scanPartida(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainmatch.Partida{}, nil, domainmatch.ErrNotFound
	}
	if err != nil {
		return domainmatch.Partida{}, nil, fmt.Errorf("find partida: %w", err)
	}
	linhas, err := r.linhasOf(ctx, p.ID)
	if err != nil {
		return domainmatch.Partida{}, nil, err
	}
	return p, linhas, nil
}

func (r *PartidaRepository) FindByID(ctx context.Context, id string) (domainmatch.Partida, []domainmatch.LinhaPartida, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+partidaColumns+` FROM clubs_matches WHERE id = $1`, id)
	p, err := scanPartida(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainmatch.Partida{}, nil, domainmatch.ErrNotFound
	}
	if err != nil {
		return domainmatch.Partida{}, nil, fmt.Errorf("find partida by id: %w", err)
	}
	linhas, err := r.linhasOf(ctx, p.ID)
	if err != nil {
		return domainmatch.Partida{}, nil, err
	}
	return p, linhas, nil
}

func (r *PartidaRepository) linhasOf(ctx context.Context, partidaID string) ([]domainmatch.LinhaPartida, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+linhaColumns+` FROM clubs_match_players WHERE match_id_uuid = $1 ORDER BY rating DESC`, partidaID)
	if err != nil {
		return nil, fmt.Errorf("list linhas: %w", err)
	}
	defer rows.Close()

	var list []domainmatch.LinhaPartida
	for rows.Next() {
		l, err := scanLinha(rows)
		if err != nil {
			return nil, fmt.Errorf("scan linha: %w", err)
		}
		list = append(list, l)
	}
	return list, rows.Err()
}

// ListByClub returns a club's matches from either side, newest first. An
// empty tipo means "todos".
func (r *PartidaRepository) ListByClub(ctx context.Context, clubID, kind string, limit int) ([]domainmatch.Partida, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if kind == "" {
		rows, err = r.pool.Query(ctx, `
			SELECT `+partidaColumns+` FROM clubs_matches
			WHERE home_club_id = $1 OR away_club_id = $1
			ORDER BY timestamp DESC LIMIT $2`, clubID, limit)
	} else {
		rows, err = r.pool.Query(ctx, `
			SELECT `+partidaColumns+` FROM clubs_matches
			WHERE (home_club_id = $1 OR away_club_id = $1) AND kind = $2
			ORDER BY timestamp DESC LIMIT $3`, clubID, kind, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("list matches: %w", err)
	}
	defer rows.Close()

	var list []domainmatch.Partida
	for rows.Next() {
		p, err := scanPartida(rows)
		if err != nil {
			return nil, fmt.Errorf("scan partida: %w", err)
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

func (r *PartidaRepository) ListByClubComLinhas(ctx context.Context, clubID string, limit int) ([]domainmatch.PartidaComLinhas, error) {
	list, err := r.ListByClub(ctx, clubID, "", limit)
	if err != nil {
		return nil, err
	}
	out := make([]domainmatch.PartidaComLinhas, 0, len(list))
	for _, p := range list {
		linhas, err := r.linhasOf(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, domainmatch.PartidaComLinhas{Partida: p, Linhas: linhas})
	}
	return out, nil
}

// AllLinesByClub returns every player line of every match the club played,
// joined with its match — the raw material for squad aggregation, records
// and the cross-club player index.
func (r *PartidaRepository) AllLinesByClub(ctx context.Context, clubID string) ([]domainmatch.LinhaComPartida, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.`+"club_id, player_id, gamertag, position, rating, goals, assists, shots, passes_made, passes_attempted, tackles_made, tackles_attempted, saves, saves_by_type, seconds_played, man_of_the_match, red_card, clean_sheet"+`,
		       m.`+partidaColumns+`
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.match_id_uuid
		WHERE l.club_id = $1
		ORDER BY m.timestamp DESC`, clubID)
	if err != nil {
		return nil, fmt.Errorf("list all lines: %w", err)
	}
	defer rows.Close()

	var out []domainmatch.LinhaComPartida
	for rows.Next() {
		var l domainmatch.LinhaPartida
		var p domainmatch.Partida
		if err := rows.Scan(
			&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Position, &l.Rating, &l.Goals, &l.Assists, &l.Shots,
			&l.PassesMade, &l.PassesAttempted, &l.TacklesMade, &l.TacklesAttempted, &l.Saves,
			&l.SavesByType, &l.SecondsPlayed, &l.ManOfTheMatch, &l.RedCard, &l.CleanSheet,
			&p.ID, &p.MatchID, &p.Timestamp, &p.Kind, &p.PlayoffRound, &p.ClubeCasaID, &p.ClubeForaID,
			&p.HomeGoals, &p.AwayGoals, &p.DecidedByForfeit, &p.VencedorPorDesistenciaID, &p.HomeResult,
			&p.Events, &p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan line+match: %w", err)
		}
		out = append(out, domainmatch.LinhaComPartida{Linha: l, Partida: p})
	}
	return out, rows.Err()
}

// ListAll returns every match — the global rankings and the admin counters
// work over the whole dataset.
func (r *PartidaRepository) ListAll(ctx context.Context, limit int) ([]domainmatch.Partida, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+partidaColumns+` FROM clubs_matches ORDER BY timestamp DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list all matches: %w", err)
	}
	defer rows.Close()

	var list []domainmatch.Partida
	for rows.Next() {
		p, err := scanPartida(rows)
		if err != nil {
			return nil, fmt.Errorf("scan partida: %w", err)
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

// HeadToHead returns every match two clubs played against each other,
// newest first — the H2H aggregate.
func (r *PartidaRepository) HeadToHead(ctx context.Context, aID, bID string) ([]domainmatch.Partida, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+partidaColumns+` FROM clubs_matches
		WHERE (home_club_id = $1 AND away_club_id = $2)
		   OR (home_club_id = $2 AND away_club_id = $1)
		ORDER BY timestamp DESC`, aID, bID)
	if err != nil {
		return nil, fmt.Errorf("h2h: %w", err)
	}
	defer rows.Close()

	var list []domainmatch.Partida
	for rows.Next() {
		p, err := scanPartida(rows)
		if err != nil {
			return nil, fmt.Errorf("scan h2h: %w", err)
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

// AllLines returns every player line in the dataset — the cross-club index
// the source cannot offer (it has no player search).
func (r *PartidaRepository) AllLines(ctx context.Context) ([]domainmatch.LinhaComPartida, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.`+"club_id, player_id, gamertag, position, rating, goals, assists, shots, passes_made, passes_attempted, tackles_made, tackles_attempted, saves, saves_by_type, seconds_played, man_of_the_match, red_card, clean_sheet"+`,
		       m.`+partidaColumns+`
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.match_id_uuid
		ORDER BY m.timestamp DESC`)
	if err != nil {
		return nil, fmt.Errorf("list all lines: %w", err)
	}
	defer rows.Close()

	var out []domainmatch.LinhaComPartida
	for rows.Next() {
		var l domainmatch.LinhaPartida
		var p domainmatch.Partida
		if err := rows.Scan(
			&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Position, &l.Rating, &l.Goals, &l.Assists, &l.Shots,
			&l.PassesMade, &l.PassesAttempted, &l.TacklesMade, &l.TacklesAttempted, &l.Saves,
			&l.SavesByType, &l.SecondsPlayed, &l.ManOfTheMatch, &l.RedCard, &l.CleanSheet,
			&p.ID, &p.MatchID, &p.Timestamp, &p.Kind, &p.PlayoffRound, &p.ClubeCasaID, &p.ClubeForaID,
			&p.HomeGoals, &p.AwayGoals, &p.DecidedByForfeit, &p.VencedorPorDesistenciaID, &p.HomeResult,
			&p.Events, &p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan all lines: %w", err)
		}
		out = append(out, domainmatch.LinhaComPartida{Linha: l, Partida: p})
	}
	return out, rows.Err()
}
