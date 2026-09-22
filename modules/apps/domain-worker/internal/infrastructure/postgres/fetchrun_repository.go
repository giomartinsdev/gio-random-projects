package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// FetchRunRepository guards clubs_fetch_runs: a fila de fetch sob demanda de um
// clube, escrita pela tela de resgate e consumida pelo worker de ingestão.
//
// Não é um agregado de domínio: não há invariante além de "uma linha por
// clube", e o formato é o mesmo do clubs_sync_runs -- a SPA só precisa saber
// se ainda está rodando e quantos jogadores vieram.
type FetchRunRepository struct {
	pool *pgxpool.Pool
}

func NewFetchRunRepository(pool *pgxpool.Pool) *FetchRunRepository {
	return &FetchRunRepository{pool: pool}
}

// Save é upsert por clube. Idempotente de propósito: a SPA pode pedir o mesmo
// clube de novo (reload, clique duplo) sem gerar trabalho duplicado -- o
// segundo pedido só reabre a linha.
func (r *FetchRunRepository) Save(ctx context.Context, clubID string, rodando bool,
	jogadores, partidas int, erro string, concluido bool) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_fetch_runs (club_id, rodando, jogadores, partidas, erro, solicitado_em, concluido_em)
		VALUES ($1, $2, $3, $4, $5, now(), CASE WHEN $6 THEN now() ELSE NULL END)
		ON CONFLICT (club_id) DO UPDATE SET
			rodando = EXCLUDED.rodando,
			jogadores = EXCLUDED.jogadores,
			partidas = EXCLUDED.partidas,
			erro = EXCLUDED.erro,
			concluido_em = EXCLUDED.concluido_em`,
		clubID, rodando, jogadores, partidas, erro, concluido)
	if err != nil {
		return fmt.Errorf("save fetch run: %w", err)
	}
	return nil
}
