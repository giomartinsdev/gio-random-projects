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
	played, goals, assists, manOfTheMatch int, rating float64, position string) error {
	if clubID == "" || gamertag == "" {
		return fmt.Errorf("career: club_id e gamertag são obrigatórios")
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_player_career
			(club_id, gamertag, played, goals, assists, man_of_the_match, rating, position, read_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
		ON CONFLICT (club_id, gamertag) DO UPDATE SET
			played = EXCLUDED.played,
			goals = EXCLUDED.goals,
			assists = EXCLUDED.assists,
			man_of_the_match = EXCLUDED.man_of_the_match,
			rating = EXCLUDED.rating,
			position = EXCLUDED.position,
			read_at = now()`,
		clubID, gamertag, played, goals, assists, manOfTheMatch, rating, position)
	if err != nil {
		return fmt.Errorf("save career: %w", err)
	}
	return nil
}
