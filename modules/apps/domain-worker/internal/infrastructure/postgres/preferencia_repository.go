package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preferencia"
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

func (r *PreferenciaRepository) ListWatch(ctx context.Context, usuarioEmail string) ([]domainpref.WatchEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT usuario_email, club_id, seguindo_desde, origem
		FROM clubs_watchlist WHERE usuario_email = $1 ORDER BY seguindo_desde DESC`, usuarioEmail)
	if err != nil {
		return nil, fmt.Errorf("list watch: %w", err)
	}
	defer rows.Close()

	var list []domainpref.WatchEntry
	for rows.Next() {
		var e domainpref.WatchEntry
		if err := rows.Scan(&e.UsuarioEmail, &e.ClubID, &e.SeguindoDesde, &e.Origem); err != nil {
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
		INSERT INTO clubs_watchlist (usuario_email, club_id, seguindo_desde, origem)
		VALUES ($1,$2, now(), $3)
		ON CONFLICT (usuario_email, club_id) DO NOTHING`,
		e.UsuarioEmail, e.ClubID, e.Origem)
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
		INSERT INTO clubs_watchlist (usuario_email, club_id, seguindo_desde, origem)
		VALUES ($1,$2, now(), $3)
		ON CONFLICT (usuario_email, club_id) DO UPDATE SET origem = EXCLUDED.origem`,
		e.UsuarioEmail, e.ClubID, e.Origem)
	if err != nil {
		return fmt.Errorf("set watch origem: %w", err)
	}
	return nil
}

func (r *PreferenciaRepository) RemoveWatch(ctx context.Context, usuarioEmail, clubID string) error {
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM clubs_watchlist WHERE usuario_email = $1 AND club_id = $2`,
		usuarioEmail, clubID); err != nil {
		return fmt.Errorf("remove watch: %w", err)
	}
	return nil
}

func (r *PreferenciaRepository) IsWatched(ctx context.Context, usuarioEmail, clubID string) (bool, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM clubs_watchlist WHERE usuario_email = $1 AND club_id = $2)`,
		usuarioEmail, clubID).Scan(&exists); err != nil {
		return false, fmt.Errorf("is watched: %w", err)
	}
	return exists, nil
}

// ------------------------------------------------------------- notificações

func (r *PreferenciaRepository) GetNotificacoes(ctx context.Context, usuarioEmail string) (domainpref.Notificacoes, error) {
	var n domainpref.Notificacoes
	err := r.pool.QueryRow(ctx, `
		SELECT usuario_email, canal, resumo_periodico, recordes_e_divisoes, resultado_partidas, atualizado_em
		FROM clubs_preferences WHERE usuario_email = $1`, usuarioEmail).
		Scan(&n.UsuarioEmail, &n.Canal, &n.ResumoPeriodico, &n.RecordesEDivisoes, &n.ResultadoPartidas, &n.AtualizadoEm)
	if errors.Is(err, pgx.ErrNoRows) {
		// A person who never opened the screen still gets the defaults,
		// with no channel — so nothing is sent until they configure one.
		return domainpref.DefaultNotificacoes(usuarioEmail), nil
	}
	if err != nil {
		return domainpref.Notificacoes{}, fmt.Errorf("get notificacoes: %w", err)
	}
	return n, nil
}

func (r *PreferenciaRepository) UpsertNotificacoes(ctx context.Context, n domainpref.Notificacoes) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_preferences (usuario_email, canal, resumo_periodico, recordes_e_divisoes,
			resultado_partidas, atualizado_em)
		VALUES ($1,$2,$3,$4,$5, now())
		ON CONFLICT (usuario_email) DO UPDATE SET
			canal = EXCLUDED.canal,
			resumo_periodico = EXCLUDED.resumo_periodico,
			recordes_e_divisoes = EXCLUDED.recordes_e_divisoes,
			resultado_partidas = EXCLUDED.resultado_partidas,
			atualizado_em = now()`,
		n.UsuarioEmail, n.Canal, n.ResumoPeriodico, n.RecordesEDivisoes, n.ResultadoPartidas)
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
		"resumo":   "resumo_periodico",
		"recordes": "recordes_e_divisoes",
		"partidas": "resultado_partidas",
	}[kind]
	if column == "" {
		return nil, fmt.Errorf("unknown notification kind: %q", kind)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT usuario_email, canal, resumo_periodico, recordes_e_divisoes, resultado_partidas, atualizado_em
		FROM clubs_preferences WHERE canal <> '' AND `+column+` = true`)
	if err != nil {
		return nil, fmt.Errorf("list notify enabled: %w", err)
	}
	defer rows.Close()

	var list []domainpref.Notificacoes
	for rows.Next() {
		var n domainpref.Notificacoes
		if err := rows.Scan(&n.UsuarioEmail, &n.Canal, &n.ResumoPeriodico, &n.RecordesEDivisoes,
			&n.ResultadoPartidas, &n.AtualizadoEm); err != nil {
			return nil, fmt.Errorf("scan notify: %w", err)
		}
		list = append(list, n)
	}
	return list, rows.Err()
}

// ---------------------------------------------------------- pro reivindicado

func (r *PreferenciaRepository) GetClaimed(ctx context.Context, usuarioEmail string) (domainpref.ProReivindicado, error) {
	var p domainpref.ProReivindicado
	err := r.pool.QueryRow(ctx, `
		SELECT usuario_email, club_id, player_id, verificado, reivindicado_em
		FROM clubs_claimed_pros WHERE usuario_email = $1`, usuarioEmail).
		Scan(&p.UsuarioEmail, &p.ClubID, &p.PlayerID, &p.Verificado, &p.ReivindicadoEm)
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
		INSERT INTO clubs_claimed_pros (usuario_email, club_id, player_id, verificado, reivindicado_em)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (usuario_email) DO UPDATE SET
			club_id = EXCLUDED.club_id,
			player_id = EXCLUDED.player_id,
			verificado = EXCLUDED.verificado,
			reivindicado_em = now()`,
		p.UsuarioEmail, p.ClubID, p.PlayerID, p.Verificado)
	if err != nil {
		return fmt.Errorf("upsert claimed: %w", err)
	}
	return nil
}

// ListClaimedPlayerIDs returns every claimed player id across all people —
// the API uses it to mark which player profiles carry a verified badge
// without exposing who claimed them.
func (r *PreferenciaRepository) ListClaimedPlayerIDs(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT player_id FROM clubs_claimed_pros WHERE verificado = true`)
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

func (r *PreferenciaRepository) GetSyncRun(ctx context.Context, usuarioEmail string) (domainpref.SyncRun, error) {
	var run domainpref.SyncRun
	var novos []byte
	err := r.pool.QueryRow(ctx, `
		SELECT usuario_email, rodando, nivel, total, concluidos, atual, novos, iniciado_em, concluido_em
		FROM clubs_sync_runs WHERE usuario_email = $1`, usuarioEmail).
		Scan(&run.UsuarioEmail, &run.Rodando, &run.Nivel, &run.Total, &run.Concluidos,
			&run.Atual, &novos, &run.IniciadoEm, &run.ConcluidoEm)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpref.SyncRun{UsuarioEmail: usuarioEmail}, nil
	}
	if err != nil {
		return domainpref.SyncRun{}, fmt.Errorf("get sync run: %w", err)
	}
	if len(novos) > 0 {
		_ = json.Unmarshal(novos, &run.Novos)
	}
	return run, nil
}

func (r *PreferenciaRepository) UpsertSyncRun(ctx context.Context, run domainpref.SyncRun) error {
	novos, err := json.Marshal(run.Novos)
	if err != nil {
		return fmt.Errorf("marshal novos: %w", err)
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO clubs_sync_runs (usuario_email, rodando, nivel, total, concluidos, atual, novos,
			iniciado_em, concluido_em)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (usuario_email) DO UPDATE SET
			rodando = EXCLUDED.rodando,
			nivel = EXCLUDED.nivel,
			total = EXCLUDED.total,
			concluidos = EXCLUDED.concluidos,
			atual = EXCLUDED.atual,
			novos = EXCLUDED.novos,
			iniciado_em = EXCLUDED.iniciado_em,
			concluido_em = EXCLUDED.concluido_em`,
		run.UsuarioEmail, run.Rodando, run.Nivel, run.Total, run.Concluidos, run.Atual, novos,
		nullableTime(run.IniciadoEm), nullableTime(run.ConcluidoEm))
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
