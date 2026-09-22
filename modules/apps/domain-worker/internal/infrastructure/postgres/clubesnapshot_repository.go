package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainsnapshot "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/clubesnapshot"
)

// ClubSnapshotRepository implements domain/clubesnapshot.Repository.
// Append is the only write — a snapshot is never updated.
type ClubSnapshotRepository struct {
	pool *pgxpool.Pool
}

func NewClubSnapshotRepository(pool *pgxpool.Pool) *ClubSnapshotRepository {
	return &ClubSnapshotRepository{pool: pool}
}

const snapshotColumns = `id, club_id, lido_em, nivel, divisao, jogos, vitorias, empates,
	derrotas, gols, gols_sofridos, tamanho_elenco`

func scanSnapshot(row pgx.Row) (domainsnapshot.Snapshot, error) {
	var s domainsnapshot.Snapshot
	err := row.Scan(&s.ID, &s.ClubID, &s.LidoEm, &s.Nivel, &s.Divisao, &s.Jogos, &s.Vitorias,
		&s.Empates, &s.Derrotas, &s.Gols, &s.GolsSofridos, &s.TamanhoElenco)
	return s, err
}

// Append writes the reading, then diffs it against the most recent previous
// one for the same club and records a division change when the division
// moved. All in one transaction so a crash can't leave a snapshot without
// its derived event.
func (r *ClubSnapshotRepository) Append(ctx context.Context, s domainsnapshot.Snapshot) (*domainsnapshot.MudancaDivisao, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin snapshot tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	prev, prevErr := scanSnapshot(tx.QueryRow(ctx,
		`SELECT `+snapshotColumns+` FROM clubs_snapshots WHERE club_id = $1 ORDER BY lido_em DESC LIMIT 1`,
		s.ClubID))

	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO clubs_snapshots (id, club_id, lido_em, nivel, divisao, jogos, vitorias,
			empates, derrotas, gols, gols_sofridos, tamanho_elenco)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		s.ID, s.ClubID, s.LidoEm, s.Nivel, s.Divisao, s.Jogos, s.Vitorias,
		s.Empates, s.Derrotas, s.Gols, s.GolsSofridos, s.TamanhoElenco); err != nil {
		return nil, fmt.Errorf("append snapshot: %w", err)
	}

	var change *domainsnapshot.MudancaDivisao
	if prevErr == nil {
		change = domainsnapshot.Diff(prev, s)
	} else if !errors.Is(prevErr, pgx.ErrNoRows) {
		return nil, fmt.Errorf("read previous snapshot: %w", prevErr)
	}

	if change != nil {
		change.ID = uuid.NewString()
		if _, err := tx.Exec(ctx, `
			INSERT INTO clubs_division_changes (id, club_id, detectado_em, de, para, tipo)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			change.ID, change.ClubID, change.DetectadoEm, change.De, change.Para, change.Tipo); err != nil {
			return nil, fmt.Errorf("insert division change: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit snapshot tx: %w", err)
	}
	return change, nil
}

func (r *ClubSnapshotRepository) Latest(ctx context.Context, clubID string) (domainsnapshot.Snapshot, error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+snapshotColumns+` FROM clubs_snapshots WHERE club_id = $1 ORDER BY lido_em DESC LIMIT 1`, clubID)
	s, err := scanSnapshot(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainsnapshot.Snapshot{}, domainsnapshot.ErrNotFound
	}
	if err != nil {
		return domainsnapshot.Snapshot{}, fmt.Errorf("latest snapshot: %w", err)
	}
	return s, nil
}

// Series returns the readings oldest first — directly the shape a line
// chart consumes. A zero `since` means "toda a série".
func (r *ClubSnapshotRepository) Series(ctx context.Context, clubID string, since time.Time) ([]domainsnapshot.Snapshot, error) {
	var rows pgx.Rows
	var err error
	if since.IsZero() {
		rows, err = r.pool.Query(ctx,
			`SELECT `+snapshotColumns+` FROM clubs_snapshots WHERE club_id = $1 ORDER BY lido_em ASC`, clubID)
	} else {
		rows, err = r.pool.Query(ctx,
			`SELECT `+snapshotColumns+` FROM clubs_snapshots WHERE club_id = $1 AND lido_em >= $2 ORDER BY lido_em ASC`,
			clubID, since)
	}
	if err != nil {
		return nil, fmt.Errorf("series: %w", err)
	}
	defer rows.Close()

	var list []domainsnapshot.Snapshot
	for rows.Next() {
		s, err := scanSnapshot(rows)
		if err != nil {
			return nil, fmt.Errorf("scan snapshot: %w", err)
		}
		list = append(list, s)
	}
	return list, rows.Err()
}

func (r *ClubSnapshotRepository) Changes(ctx context.Context, clubID string) ([]domainsnapshot.MudancaDivisao, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, club_id, detectado_em, de, para, tipo
		FROM clubs_division_changes WHERE club_id = $1 ORDER BY detectado_em DESC`, clubID)
	if err != nil {
		return nil, fmt.Errorf("changes: %w", err)
	}
	defer rows.Close()

	var list []domainsnapshot.MudancaDivisao
	for rows.Next() {
		var m domainsnapshot.MudancaDivisao
		if err := rows.Scan(&m.ID, &m.ClubID, &m.DetectadoEm, &m.De, &m.Para, &m.Tipo); err != nil {
			return nil, fmt.Errorf("scan change: %w", err)
		}
		list = append(list, m)
	}
	return list, rows.Err()
}

// CountForClub reports how many readings a club has — the admin counter.
func (r *ClubSnapshotRepository) CountForClub(ctx context.Context, clubID string) (int, error) {
	var n int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM clubs_snapshots WHERE club_id = $1`, clubID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count snapshots: %w", err)
	}
	return n, nil
}

// AllSeriesGrouped returns every snapshot — the admin dashboard and the
// global evolution charts read it.
func (r *ClubSnapshotRepository) All(ctx context.Context) ([]domainsnapshot.Snapshot, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+snapshotColumns+` FROM clubs_snapshots ORDER BY lido_em DESC`)
	if err != nil {
		return nil, fmt.Errorf("all snapshots: %w", err)
	}
	defer rows.Close()

	var list []domainsnapshot.Snapshot
	for rows.Next() {
		s, err := scanSnapshot(rows)
		if err != nil {
			return nil, fmt.Errorf("scan snapshot: %w", err)
		}
		list = append(list, s)
	}
	return list, rows.Err()
}
