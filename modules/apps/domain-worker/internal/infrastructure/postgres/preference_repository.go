package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preference"
)

// PreferenciaRepository implements domain/preferencia.Repository. Every
// read filters by usuario_email — that is the mechanism that keeps one
// person's watchlist and claimed pro out of another's response.
type PreferenciaRepository struct {
	pool *pgxpool.Pool
}

func NewPreferenciaRepository(pool *pgxpool.Pool) *PreferenciaRepository {
	return &PreferenciaRepository{pool: pool}
}

// ---------------------------------------------------------------- watchlist

func (r *PreferenciaRepository) ListWatch(ctx context.Context, userEmail string) ([]domainpref.WatchEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT user_email, club_id, tracked_since, source
		FROM clubs_watchlist WHERE user_email = $1 ORDER BY tracked_since DESC`, userEmail)
	if err != nil {
		return nil, fmt.Errorf("list watch: %w", err)
	}
	defer rows.Close()

	var list []domainpref.WatchEntry
	for rows.Next() {
		var e domainpref.WatchEntry
		if err := rows.Scan(&e.UserEmail, &e.ClubID, &e.TrackedSince, &e.Source); err != nil {
			return nil, fmt.Errorf("scan watch: %w", err)
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

// SetWatch is an upsert: following a club already followed is a no-op that
// keeps the original seguindo_desde, so the "since" date never drifts.
func (r *PreferenciaRepository) SetWatch(ctx context.Context, e domainpref.WatchEntry) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_watchlist (user_email, club_id, tracked_since, source)
		VALUES ($1,$2, now(), $3)
		ON CONFLICT (user_email, club_id) DO NOTHING`,
		e.UserEmail, e.ClubID, e.Source)
	if err != nil {
		return fmt.Errorf("set watch: %w", err)
	}
	return nil
}

// SetWatchWithOrigem updates the origem of an existing follow — used by the
// sync to upgrade a club from "rival" to "proprio" when it turns out the
// person plays there.
func (r *PreferenciaRepository) SetWatchWithOrigem(ctx context.Context, e domainpref.WatchEntry) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_watchlist (user_email, club_id, tracked_since, source)
		VALUES ($1,$2, now(), $3)
		ON CONFLICT (user_email, club_id) DO UPDATE SET source = EXCLUDED.source`,
		e.UserEmail, e.ClubID, e.Source)
	if err != nil {
		return fmt.Errorf("set watch source: %w", err)
	}
	return nil
}

func (r *PreferenciaRepository) RemoveWatch(ctx context.Context, userEmail, clubID string) error {
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM clubs_watchlist WHERE user_email = $1 AND club_id = $2`,
		userEmail, clubID); err != nil {
		return fmt.Errorf("remove watch: %w", err)
	}
	return nil
}

func (r *PreferenciaRepository) IsWatched(ctx context.Context, userEmail, clubID string) (bool, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM clubs_watchlist WHERE user_email = $1 AND club_id = $2)`,
		userEmail, clubID).Scan(&exists); err != nil {
		return false, fmt.Errorf("is watched: %w", err)
	}
	return exists, nil
}

// ------------------------------------------------------------- notificações

func (r *PreferenciaRepository) GetNotificacoes(ctx context.Context, userEmail string) (domainpref.Notificacoes, error) {
	var n domainpref.Notificacoes
	err := r.pool.QueryRow(ctx, `
		SELECT user_email, channel, weekly_digest, records_and_divisions, match_results, updated_at
		FROM clubs_preferences WHERE user_email = $1`, userEmail).
		Scan(&n.UserEmail, &n.Channel, &n.WeeklyDigest, &n.RecordsAndDivisions, &n.MatchResults, &n.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// A person who never opened the screen still gets the defaults,
		// with no channel — so nothing is sent until they configure one.
		return domainpref.DefaultNotificacoes(userEmail), nil
	}
	if err != nil {
		return domainpref.Notificacoes{}, fmt.Errorf("get notificacoes: %w", err)
	}
	return n, nil
}

func (r *PreferenciaRepository) UpsertNotificacoes(ctx context.Context, n domainpref.Notificacoes) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_preferences (user_email, channel, weekly_digest, records_and_divisions,
			match_results, updated_at)
		VALUES ($1,$2,$3,$4,$5, now())
		ON CONFLICT (user_email) DO UPDATE SET
			channel = EXCLUDED.channel,
			weekly_digest = EXCLUDED.weekly_digest,
			records_and_divisions = EXCLUDED.records_and_divisions,
			match_results = EXCLUDED.match_results,
			updated_at = now()`,
		n.UserEmail, n.Channel, n.WeeklyDigest, n.RecordsAndDivisions, n.MatchResults)
	if err != nil {
		return fmt.Errorf("upsert notificacoes: %w", err)
	}
	return nil
}

// ListNotifyEnabled returns everyone who wants a given kind of notification
// AND has a channel — the ingest's recipient list. kind is one of
// "resumo", "recordes", "partidas".
func (r *PreferenciaRepository) ListNotifyEnabled(ctx context.Context, kind string) ([]domainpref.Notificacoes, error) {
	column := map[string]string{
		"resumo":   "weekly_digest",
		"records": "records_and_divisions",
		"matches": "match_results",
	}[kind]
	if column == "" {
		return nil, fmt.Errorf("unknown notification kind: %q", kind)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT user_email, channel, weekly_digest, records_and_divisions, match_results, updated_at
		FROM clubs_preferences WHERE channel <> '' AND `+column+` = true`)
	if err != nil {
		return nil, fmt.Errorf("list notify enabled: %w", err)
	}
	defer rows.Close()

	var list []domainpref.Notificacoes
	for rows.Next() {
		var n domainpref.Notificacoes
		if err := rows.Scan(&n.UserEmail, &n.Channel, &n.WeeklyDigest, &n.RecordsAndDivisions,
			&n.MatchResults, &n.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan notify: %w", err)
		}
		list = append(list, n)
	}
	return list, rows.Err()
}

// ---------------------------------------------------------- pro reivindicado

func (r *PreferenciaRepository) GetClaimed(ctx context.Context, userEmail string) (domainpref.ProReivindicado, error) {
	var p domainpref.ProReivindicado
	err := r.pool.QueryRow(ctx, `
		SELECT user_email, club_id, player_id, verified, claimed_at
		FROM clubs_claimed_pros WHERE user_email = $1`, userEmail).
		Scan(&p.UserEmail, &p.ClubID, &p.PlayerID, &p.Verified, &p.ClaimedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpref.ProReivindicado{}, domainpref.ErrNotFound
	}
	if err != nil {
		return domainpref.ProReivindicado{}, fmt.Errorf("get claimed: %w", err)
	}
	return p, nil
}

func (r *PreferenciaRepository) UpsertClaimed(ctx context.Context, p domainpref.ProReivindicado) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_claimed_pros (user_email, club_id, player_id, verified, claimed_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (user_email) DO UPDATE SET
			club_id = EXCLUDED.club_id,
			player_id = EXCLUDED.player_id,
			verified = EXCLUDED.verified,
			claimed_at = now()`,
		p.UserEmail, p.ClubID, p.PlayerID, p.Verified)
	if err != nil {
		return fmt.Errorf("upsert claimed: %w", err)
	}
	return nil
}

// ListClaimedPlayerIDs returns every claimed player id across all people —
// the API uses it to mark which player profiles carry a verified badge
// without exposing who claimed them.
func (r *PreferenciaRepository) ListClaimedPlayerIDs(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT player_id FROM clubs_claimed_pros WHERE verified = true`)
	if err != nil {
		return nil, fmt.Errorf("list claimed ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan claimed id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ------------------------------------------------------------------- sync

func (r *PreferenciaRepository) GetSyncRun(ctx context.Context, userEmail string) (domainpref.SyncRun, error) {
	var run domainpref.SyncRun
	var new_items []byte
	err := r.pool.QueryRow(ctx, `
		SELECT user_email, running, skill_rating, total, completed, current, new_items, started_at, finished_at
		FROM clubs_sync_runs WHERE user_email = $1`, userEmail).
		Scan(&run.UserEmail, &run.Running, &run.SkillRating, &run.Total, &run.Completed,
			&run.Current, &new_items, &run.StartedAt, &run.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpref.SyncRun{UserEmail: userEmail}, nil
	}
	if err != nil {
		return domainpref.SyncRun{}, fmt.Errorf("get sync run: %w", err)
	}
	if len(new_items) > 0 {
		_ = json.Unmarshal(new_items, &run.NewItems)
	}
	return run, nil
}

func (r *PreferenciaRepository) UpsertSyncRun(ctx context.Context, run domainpref.SyncRun) error {
	new_items, err := json.Marshal(run.NewItems)
	if err != nil {
		return fmt.Errorf("marshal new_items: %w", err)
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO clubs_sync_runs (user_email, running, skill_rating, total, completed, current, new_items,
			started_at, finished_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (user_email) DO UPDATE SET
			running = EXCLUDED.running,
			skill_rating = EXCLUDED.skill_rating,
			total = EXCLUDED.total,
			completed = EXCLUDED.completed,
			current = EXCLUDED.current,
			new_items = EXCLUDED.new_items,
			started_at = EXCLUDED.started_at,
			finished_at = EXCLUDED.finished_at`,
		run.UserEmail, run.Running, run.SkillRating, run.Total, run.Completed, run.Current, new_items,
		nullableTime(run.StartedAt), nullableTime(run.FinishedAt))
	if err != nil {
		return fmt.Errorf("upsert sync run: %w", err)
	}
	return nil
}

// nullableTime turns a zero time into NULL so the column can stay nullable
// without a sentinel year-1 timestamp.
func nullableTime(t interface{ IsZero() bool }) any {
	type timeValuer interface {
		IsZero() bool
	}
	if tv, ok := t.(timeValuer); ok && tv.IsZero() {
		return nil
	}
	return t
}
