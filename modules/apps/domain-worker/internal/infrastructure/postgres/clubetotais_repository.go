package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domaintotais "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/clubetotais"
)

// ClubeTotaisRepository implements domain/clubetotais.Repository.
type ClubeTotaisRepository struct {
	pool *pgxpool.Pool
}

func NewClubeTotaisRepository(pool *pgxpool.Pool) *ClubeTotaisRepository {
	return &ClubeTotaisRepository{pool: pool}
}

const totaisColumns = `club_id, jogos, vitorias, empates, derrotas, gols, gols_sofridos,
	jogos_sem_sofrer, pontos, divisao_atual, melhor_divisao, nivel, promocoes, rebaixamentos, lido_em`

func scanTotais(row pgx.Row) (domaintotais.Totais, error) {
	var t domaintotais.Totais
	err := row.Scan(
		&t.ClubID, &t.Jogos, &t.Vitorias, &t.Empates, &t.Derrotas, &t.Gols, &t.GolsSofridos,
		&t.JogosSemSofrer, &t.Pontos, &t.DivisaoAtual, &t.MelhorDivisao, &t.Nivel,
		&t.Promocoes, &t.Rebaixamentos, &t.LidoEm,
	)
	return t, err
}

func (r *ClubeTotaisRepository) FindByClub(ctx context.Context, clubID string) (domaintotais.Totais, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+totaisColumns+` FROM clubs_totais WHERE club_id = $1`, clubID)
	t, err := scanTotais(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domaintotais.Totais{}, domaintotais.ErrNotFound
	}
	if err != nil {
		return domaintotais.Totais{}, fmt.Errorf("find clube totais: %w", err)
	}
	return t, nil
}

const totaisUpsert = `
	INSERT INTO clubs_totais (club_id, jogos, vitorias, empates, derrotas, gols, gols_sofridos,
		jogos_sem_sofrer, pontos, divisao_atual, melhor_divisao, nivel, promocoes, rebaixamentos, lido_em)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
	ON CONFLICT (club_id) DO UPDATE SET
		jogos = EXCLUDED.jogos, vitorias = EXCLUDED.vitorias, empates = EXCLUDED.empates,
		derrotas = EXCLUDED.derrotas, gols = EXCLUDED.gols, gols_sofridos = EXCLUDED.gols_sofridos,
		jogos_sem_sofrer = EXCLUDED.jogos_sem_sofrer, pontos = EXCLUDED.pontos,
		divisao_atual = EXCLUDED.divisao_atual, melhor_divisao = EXCLUDED.melhor_divisao,
		nivel = EXCLUDED.nivel, promocoes = EXCLUDED.promocoes, rebaixamentos = EXCLUDED.rebaixamentos,
		lido_em = now()`

func (r *ClubeTotaisRepository) Upsert(ctx context.Context, t domaintotais.Totais) error {
	_, err := r.pool.Exec(ctx, totaisUpsert,
		t.ClubID, t.Jogos, t.Vitorias, t.Empates, t.Derrotas, t.Gols, t.GolsSofridos,
		t.JogosSemSofrer, t.Pontos, t.DivisaoAtual, t.MelhorDivisao, t.Nivel,
		t.Promocoes, t.Rebaixamentos)
	if err != nil {
		return fmt.Errorf("upsert clube totais: %w", err)
	}
	return nil
}

// UpsertMany writes a whole search page in one transaction — a broad search
// returning dozens of clubs should not cost dozens of round-trips.
func (r *ClubeTotaisRepository) UpsertMany(ctx context.Context, list []domaintotais.Totais) error {
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
			t.ClubID, t.Jogos, t.Vitorias, t.Empates, t.Derrotas, t.Gols, t.GolsSofridos,
			t.JogosSemSofrer, t.Pontos, t.DivisaoAtual, t.MelhorDivisao, t.Nivel,
			t.Promocoes, t.Rebaixamentos); err != nil {
			return fmt.Errorf("upsert clube totais %s: %w", t.ClubID, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit totais tx: %w", err)
	}
	return nil
}

// ListAll returns every club's totals — the global ranking's raw material.
func (r *ClubeTotaisRepository) ListAll(ctx context.Context) ([]domaintotais.Totais, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+totaisColumns+` FROM clubs_totais`)
	if err != nil {
		return nil, fmt.Errorf("list totais: %w", err)
	}
	defer rows.Close()

	var list []domaintotais.Totais
	for rows.Next() {
		t, err := scanTotais(rows)
		if err != nil {
			return nil, fmt.Errorf("scan totais: %w", err)
		}
		list = append(list, t)
	}
	return list, rows.Err()
}
