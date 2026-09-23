package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PlayerCareerRepository guarda clubs_player_career: os totais ACUMULADOS de
// um jogador num clube, do `members/career/stats` da fonte -- o que a temporada
// corrente (as partidas) não dá.
//
// A chave é (club_id, gamertag): aquele endpoint não traz playerId, então o
// nome é o único elo. A leitura casa com a linha de partida pelo gamertag.
type PlayerCareerRepository struct {
	pool *pgxpool.Pool
}

func NewPlayerCareerRepository(pool *pgxpool.Pool) *PlayerCareerRepository {
	return &PlayerCareerRepository{pool: pool}
}

// Save é upsert por (clube, gamertag): uma leitura nova substitui a anterior,
// que é o que "carreira" significa -- o acumulado, não um histórico de leituras.
func (r *PlayerCareerRepository) Save(ctx context.Context, clubID, gamertag string,
	jogos, gols, assistencias, melhorEmCampo int, nota float64, posicao string) error {
	if clubID == "" || gamertag == "" {
		return fmt.Errorf("career: club_id e gamertag são obrigatórios")
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_player_career
			(club_id, gamertag, jogos, gols, assistencias, melhor_em_campo, nota, posicao, lido_em)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
		ON CONFLICT (club_id, gamertag) DO UPDATE SET
			jogos = EXCLUDED.jogos,
			gols = EXCLUDED.gols,
			assistencias = EXCLUDED.assistencias,
			melhor_em_campo = EXCLUDED.melhor_em_campo,
			nota = EXCLUDED.nota,
			posicao = EXCLUDED.posicao,
			lido_em = now()`,
		clubID, gamertag, jogos, gols, assistencias, melhorEmCampo, nota, posicao)
	if err != nil {
		return fmt.Errorf("save career: %w", err)
	}
	return nil
}
