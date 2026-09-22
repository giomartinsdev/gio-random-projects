package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainpartida "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/partida"
)

// PartidaRepository implements domain/partida.Repository against Postgres.
type PartidaRepository struct {
	pool *pgxpool.Pool
}

func NewPartidaRepository(pool *pgxpool.Pool) *PartidaRepository {
	return &PartidaRepository{pool: pool}
}

const partidaColumns = `id, match_id, timestamp, tipo, rodada_playoff, clube_casa_id, clube_fora_id,
	gols_casa, gols_fora, houve_desistencia, vencedor_por_desistencia_id, resultado_casa, lances, criado_em`

const linhaColumns = `club_id, player_id, gamertag, posicao, nota, gols, assistencias, chutes,
	passes_certos, passes_tentados, desarmes_certos, desarmes_tentados, defesas, defesas_por_tipo,
	segundos_jogados, melhor_em_campo, cartao_vermelho, jogo_sem_sofrer_gol`

func scanPartida(row pgx.Row) (domainpartida.Partida, error) {
	var p domainpartida.Partida
	err := row.Scan(
		&p.ID, &p.MatchID, &p.Timestamp, &p.Tipo, &p.RodadaPlayoff, &p.ClubeCasaID, &p.ClubeForaID,
		&p.GolsCasa, &p.GolsFora, &p.HouveDesistencia, &p.VencedorPorDesistenciaID, &p.ResultadoCasa,
		&p.Lances, &p.CriadoEm,
	)
	return p, err
}

func scanLinha(row pgx.Row) (domainpartida.LinhaPartida, error) {
	var l domainpartida.LinhaPartida
	err := row.Scan(
		&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Posicao, &l.Nota, &l.Gols, &l.Assistencias, &l.Chutes,
		&l.PassesCertos, &l.PassesTentados, &l.DesarmesCertos, &l.DesarmesTentados, &l.Defesas,
		&l.DefesasPorTipo, &l.SegundosJogados, &l.MelhorEmCampo, &l.CartaoVermelho, &l.JogoSemSofrerGol,
	)
	return l, err
}

// UpsertByMatchID is the method that guarantees a match played between two
// followed clubs exists exactly once: the first write inserts, the second
// updates the same row (the two sides are the same match_id). The squad
// lines are replaced atomically in the same transaction, so a match is
// never left with a partial summary.
func (r *PartidaRepository) UpsertByMatchID(ctx context.Context, p domainpartida.Partida, linhas []domainpartida.LinhaPartida) (bool, error) {
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
		if p.CriadoEm.IsZero() {
			p.CriadoEm = time.Now().UTC()
		}
		if len(p.Lances) == 0 {
			p.Lances = []byte("[]")
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO clubs_matches (id, match_id, timestamp, tipo, rodada_playoff,
				clube_casa_id, clube_fora_id, gols_casa, gols_fora, houve_desistencia,
				vencedor_por_desistencia_id, resultado_casa, lances, criado_em)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			p.ID, p.MatchID, p.Timestamp, p.Tipo, p.RodadaPlayoff,
			p.ClubeCasaID, p.ClubeForaID, p.GolsCasa, p.GolsFora, p.HouveDesistencia,
			p.VencedorPorDesistenciaID, p.ResultadoCasa, p.Lances, p.CriadoEm)
		if err != nil {
			return false, fmt.Errorf("insert partida: %w", err)
		}
	case err != nil:
		return false, fmt.Errorf("lookup partida: %w", err)
	default:
		p.ID = existingID
		if len(p.Lances) == 0 {
			p.Lances = []byte("[]")
		}
		_, err = tx.Exec(ctx, `
			UPDATE clubs_matches SET timestamp = $2, tipo = $3, rodada_playoff = $4,
				clube_casa_id = $5, clube_fora_id = $6, gols_casa = $7, gols_fora = $8,
				houve_desistencia = $9, vencedor_por_desistencia_id = $10, resultado_casa = $11,
				lances = $12
			WHERE match_id = $1`,
			p.MatchID, p.Timestamp, p.Tipo, p.RodadaPlayoff,
			p.ClubeCasaID, p.ClubeForaID, p.GolsCasa, p.GolsFora, p.HouveDesistencia,
			p.VencedorPorDesistenciaID, p.ResultadoCasa, p.Lances)
		if err != nil {
			return false, fmt.Errorf("update partida: %w", err)
		}
	}

	// Replace the squad lines wholesale: a re-read of the same match is the
	// authority, and (partida_id, player_id) is unique anyway.
	if _, err := tx.Exec(ctx, `DELETE FROM clubs_match_players WHERE partida_id = $1`, p.ID); err != nil {
		return false, fmt.Errorf("clear linhas: %w", err)
	}
	for _, l := range linhas {
		if _, err := tx.Exec(ctx, `
			INSERT INTO clubs_match_players (id, partida_id, club_id, player_id, gamertag, posicao,
				nota, gols, assistencias, chutes, passes_certos, passes_tentados, desarmes_certos,
				desarmes_tentados, defesas, defesas_por_tipo, segundos_jogados, melhor_em_campo,
				cartao_vermelho, jogo_sem_sofrer_gol)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
			uuid.NewString(), p.ID, l.ClubID, l.PlayerID, l.Gamertag, l.Posicao,
			l.Nota, l.Gols, l.Assistencias, l.Chutes, l.PassesCertos, l.PassesTentados,
			l.DesarmesCertos, l.DesarmesTentados, l.Defesas, l.DefesasPorTipo, l.SegundosJogados,
			l.MelhorEmCampo, l.CartaoVermelho, l.JogoSemSofrerGol); err != nil {
			return false, fmt.Errorf("insert linha: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit partida tx: %w", err)
	}
	return inserted, nil
}

func (r *PartidaRepository) FindByMatchID(ctx context.Context, matchID string) (domainpartida.Partida, []domainpartida.LinhaPartida, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+partidaColumns+` FROM clubs_matches WHERE match_id = $1`, matchID)
	p, err := scanPartida(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpartida.Partida{}, nil, domainpartida.ErrNotFound
	}
	if err != nil {
		return domainpartida.Partida{}, nil, fmt.Errorf("find partida: %w", err)
	}
	linhas, err := r.linhasOf(ctx, p.ID)
	if err != nil {
		return domainpartida.Partida{}, nil, err
	}
	return p, linhas, nil
}

func (r *PartidaRepository) FindByID(ctx context.Context, id string) (domainpartida.Partida, []domainpartida.LinhaPartida, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+partidaColumns+` FROM clubs_matches WHERE id = $1`, id)
	p, err := scanPartida(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainpartida.Partida{}, nil, domainpartida.ErrNotFound
	}
	if err != nil {
		return domainpartida.Partida{}, nil, fmt.Errorf("find partida by id: %w", err)
	}
	linhas, err := r.linhasOf(ctx, p.ID)
	if err != nil {
		return domainpartida.Partida{}, nil, err
	}
	return p, linhas, nil
}

func (r *PartidaRepository) linhasOf(ctx context.Context, partidaID string) ([]domainpartida.LinhaPartida, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+linhaColumns+` FROM clubs_match_players WHERE partida_id = $1 ORDER BY nota DESC`, partidaID)
	if err != nil {
		return nil, fmt.Errorf("list linhas: %w", err)
	}
	defer rows.Close()

	var list []domainpartida.LinhaPartida
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
func (r *PartidaRepository) ListByClub(ctx context.Context, clubID, tipo string, limit int) ([]domainpartida.Partida, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if tipo == "" {
		rows, err = r.pool.Query(ctx, `
			SELECT `+partidaColumns+` FROM clubs_matches
			WHERE clube_casa_id = $1 OR clube_fora_id = $1
			ORDER BY timestamp DESC LIMIT $2`, clubID, limit)
	} else {
		rows, err = r.pool.Query(ctx, `
			SELECT `+partidaColumns+` FROM clubs_matches
			WHERE (clube_casa_id = $1 OR clube_fora_id = $1) AND tipo = $2
			ORDER BY timestamp DESC LIMIT $3`, clubID, tipo, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("list partidas: %w", err)
	}
	defer rows.Close()

	var list []domainpartida.Partida
	for rows.Next() {
		p, err := scanPartida(rows)
		if err != nil {
			return nil, fmt.Errorf("scan partida: %w", err)
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

func (r *PartidaRepository) ListByClubComLinhas(ctx context.Context, clubID string, limit int) ([]domainpartida.PartidaComLinhas, error) {
	list, err := r.ListByClub(ctx, clubID, "", limit)
	if err != nil {
		return nil, err
	}
	out := make([]domainpartida.PartidaComLinhas, 0, len(list))
	for _, p := range list {
		linhas, err := r.linhasOf(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, domainpartida.PartidaComLinhas{Partida: p, Linhas: linhas})
	}
	return out, nil
}

// AllLinesByClub returns every player line of every match the club played,
// joined with its match — the raw material for squad aggregation, records
// and the cross-club player index.
func (r *PartidaRepository) AllLinesByClub(ctx context.Context, clubID string) ([]domainpartida.LinhaComPartida, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.`+"club_id, player_id, gamertag, posicao, nota, gols, assistencias, chutes, passes_certos, passes_tentados, desarmes_certos, desarmes_tentados, defesas, defesas_por_tipo, segundos_jogados, melhor_em_campo, cartao_vermelho, jogo_sem_sofrer_gol"+`,
		       m.`+partidaColumns+`
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.partida_id
		WHERE l.club_id = $1
		ORDER BY m.timestamp DESC`, clubID)
	if err != nil {
		return nil, fmt.Errorf("list all lines: %w", err)
	}
	defer rows.Close()

	var out []domainpartida.LinhaComPartida
	for rows.Next() {
		var l domainpartida.LinhaPartida
		var p domainpartida.Partida
		if err := rows.Scan(
			&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Posicao, &l.Nota, &l.Gols, &l.Assistencias, &l.Chutes,
			&l.PassesCertos, &l.PassesTentados, &l.DesarmesCertos, &l.DesarmesTentados, &l.Defesas,
			&l.DefesasPorTipo, &l.SegundosJogados, &l.MelhorEmCampo, &l.CartaoVermelho, &l.JogoSemSofrerGol,
			&p.ID, &p.MatchID, &p.Timestamp, &p.Tipo, &p.RodadaPlayoff, &p.ClubeCasaID, &p.ClubeForaID,
			&p.GolsCasa, &p.GolsFora, &p.HouveDesistencia, &p.VencedorPorDesistenciaID, &p.ResultadoCasa,
			&p.Lances, &p.CriadoEm,
		); err != nil {
			return nil, fmt.Errorf("scan line+match: %w", err)
		}
		out = append(out, domainpartida.LinhaComPartida{Linha: l, Partida: p})
	}
	return out, rows.Err()
}

// ListAll returns every match — the global rankings and the admin counters
// work over the whole dataset.
func (r *PartidaRepository) ListAll(ctx context.Context, limit int) ([]domainpartida.Partida, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := r.pool.Query(ctx,
		`SELECT `+partidaColumns+` FROM clubs_matches ORDER BY timestamp DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("list all partidas: %w", err)
	}
	defer rows.Close()

	var list []domainpartida.Partida
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
func (r *PartidaRepository) HeadToHead(ctx context.Context, aID, bID string) ([]domainpartida.Partida, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+partidaColumns+` FROM clubs_matches
		WHERE (clube_casa_id = $1 AND clube_fora_id = $2)
		   OR (clube_casa_id = $2 AND clube_fora_id = $1)
		ORDER BY timestamp DESC`, aID, bID)
	if err != nil {
		return nil, fmt.Errorf("h2h: %w", err)
	}
	defer rows.Close()

	var list []domainpartida.Partida
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
func (r *PartidaRepository) AllLines(ctx context.Context) ([]domainpartida.LinhaComPartida, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.`+"club_id, player_id, gamertag, posicao, nota, gols, assistencias, chutes, passes_certos, passes_tentados, desarmes_certos, desarmes_tentados, defesas, defesas_por_tipo, segundos_jogados, melhor_em_campo, cartao_vermelho, jogo_sem_sofrer_gol"+`,
		       m.`+partidaColumns+`
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.partida_id
		ORDER BY m.timestamp DESC`)
	if err != nil {
		return nil, fmt.Errorf("list all lines: %w", err)
	}
	defer rows.Close()

	var out []domainpartida.LinhaComPartida
	for rows.Next() {
		var l domainpartida.LinhaPartida
		var p domainpartida.Partida
		if err := rows.Scan(
			&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Posicao, &l.Nota, &l.Gols, &l.Assistencias, &l.Chutes,
			&l.PassesCertos, &l.PassesTentados, &l.DesarmesCertos, &l.DesarmesTentados, &l.Defesas,
			&l.DefesasPorTipo, &l.SegundosJogados, &l.MelhorEmCampo, &l.CartaoVermelho, &l.JogoSemSofrerGol,
			&p.ID, &p.MatchID, &p.Timestamp, &p.Tipo, &p.RodadaPlayoff, &p.ClubeCasaID, &p.ClubeForaID,
			&p.GolsCasa, &p.GolsFora, &p.HouveDesistencia, &p.VencedorPorDesistenciaID, &p.ResultadoCasa,
			&p.Lances, &p.CriadoEm,
		); err != nil {
			return nil, fmt.Errorf("scan all lines: %w", err)
		}
		out = append(out, domainpartida.LinhaComPartida{Linha: l, Partida: p})
	}
	return out, rows.Err()
}
