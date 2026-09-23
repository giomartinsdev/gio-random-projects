package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// FetchRunRepository guards clubs_fetch_runs: a fila de sync sob demanda,
// escrita pela SPA e consumida pelo worker de ingestão.
//
// O alvo é genérico (`alvo`: clube | jogador) e a chave é o par (alvo, alvo_id),
// então pedir o mesmo duas vezes não duplica trabalho.
type FetchRunRepository struct {
	pool *pgxpool.Pool
}

func NewFetchRunRepository(pool *pgxpool.Pool) *FetchRunRepository {
	return &FetchRunRepository{pool: pool}
}

// Save é upsert por alvo. Idempotente de propósito: a SPA pode pedir o mesmo
// alvo de novo (reload, clique duplo) sem gerar trabalho duplicado -- o segundo
// pedido só reabre a linha.
func (r *FetchRunRepository) Save(ctx context.Context, alvo, alvoID, rotulo string, rodando bool,
	jogadores, partidas, clubes int, erro string, concluido bool) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_fetch_runs
			(alvo, alvo_id, rotulo, rodando, jogadores, partidas, clubes, erro, solicitado_em, concluido_em)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), CASE WHEN $9 THEN now() ELSE NULL END)
		ON CONFLICT (alvo, alvo_id) DO UPDATE SET
			rotulo = EXCLUDED.rotulo,
			rodando = EXCLUDED.rodando,
			jogadores = EXCLUDED.jogadores,
			partidas = EXCLUDED.partidas,
			clubes = EXCLUDED.clubes,
			erro = EXCLUDED.erro,
			concluido_em = EXCLUDED.concluido_em`,
		alvo, alvoID, rotulo, rodando, jogadores, partidas, clubes, erro, concluido)
	if err != nil {
		return fmt.Errorf("save fetch run: %w", err)
	}
	return nil
}
