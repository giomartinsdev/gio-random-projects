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

const clubColumns = `club_id, nome, sigla, estadio, regiao_id, time_id, escudo_asset_id, cor_1, cor_2, cor_3, cor_4, acompanhado, atualizado_em`

func scanClub(row pgx.Row) (domainclub.Club, error) {
	var c domainclub.Club
	err := row.Scan(
		&c.ClubID, &c.Nome, &c.Sigla, &c.Estadio, &c.RegiaoID, &c.TimeID,
		&c.EscudoAssetID, &c.Cor1, &c.Cor2, &c.Cor3, &c.Cor4, &c.Acompanhado, &c.AtualizadoEm,
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
	rows, err := r.pool.Query(ctx, `SELECT `+clubColumns+` FROM clubs WHERE acompanhado = true ORDER BY nome`)
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
		INSERT INTO clubs (club_id, nome, sigla, estadio, regiao_id, time_id, escudo_asset_id,
		                   cor_1, cor_2, cor_3, cor_4, acompanhado, atualizado_em)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
		ON CONFLICT (club_id) DO UPDATE SET
			nome            = CASE WHEN EXCLUDED.nome <> '' THEN EXCLUDED.nome ELSE clubs.nome END,
			sigla           = CASE WHEN EXCLUDED.sigla <> '' THEN EXCLUDED.sigla ELSE clubs.sigla END,
			estadio         = CASE WHEN EXCLUDED.estadio <> '' THEN EXCLUDED.estadio ELSE clubs.estadio END,
			regiao_id       = CASE WHEN EXCLUDED.regiao_id <> '' THEN EXCLUDED.regiao_id ELSE clubs.regiao_id END,
			time_id         = CASE WHEN EXCLUDED.time_id <> '' THEN EXCLUDED.time_id ELSE clubs.time_id END,
			escudo_asset_id = CASE WHEN EXCLUDED.escudo_asset_id <> '' THEN EXCLUDED.escudo_asset_id ELSE clubs.escudo_asset_id END,
			cor_1           = CASE WHEN EXCLUDED.cor_1 <> 0 THEN EXCLUDED.cor_1 ELSE clubs.cor_1 END,
			cor_2           = CASE WHEN EXCLUDED.cor_2 <> 0 THEN EXCLUDED.cor_2 ELSE clubs.cor_2 END,
			cor_3           = CASE WHEN EXCLUDED.cor_3 <> 0 THEN EXCLUDED.cor_3 ELSE clubs.cor_3 END,
			cor_4           = CASE WHEN EXCLUDED.cor_4 <> 0 THEN EXCLUDED.cor_4 ELSE clubs.cor_4 END,
			acompanhado     = clubs.acompanhado OR EXCLUDED.acompanhado,
			atualizado_em   = now()
	`, c.ClubID, c.Nome, c.Sigla, c.Estadio, c.RegiaoID, c.TimeID, c.EscudoAssetID,
		c.Cor1, c.Cor2, c.Cor3, c.Cor4, c.Acompanhado)
	if err != nil {
		return fmt.Errorf("upsert club: %w", err)
	}
	return nil
}

func (r *ClubRepository) SetAcompanhado(ctx context.Context, clubID string, acompanhado bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE clubs SET acompanhado = $2, atualizado_em = now() WHERE club_id = $1`,
		clubID, acompanhado)
	if err != nil {
		return fmt.Errorf("set acompanhado: %w", err)
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
	rows, err := r.pool.Query(ctx, `SELECT `+clubColumns+` FROM clubs ORDER BY nome`)
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
