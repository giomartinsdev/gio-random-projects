package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// IngestEstadoRepository grava a saúde do worker de ingestão. Ele não serve
// HTTP, então esta linha única é o canal pelo qual a falha dele (inclusive o
// CDN da fonte bloqueando o IP do datacenter) chega até a API.
type IngestEstadoRepository struct {
	pool *pgxpool.Pool
}

func NewIngestEstadoRepository(pool *pgxpool.Pool) *IngestEstadoRepository {
	return &IngestEstadoRepository{pool: pool}
}

// Save é upsert da linha única (id = 1). O relógio é o do banco, não o do
// worker, para "vivo" não depender de relógios diferentes.
func (r *IngestEstadoRepository) Save(ctx context.Context, rodadas, ok, falhos, novas, snapshots int,
	bootstrap bool, ultimoErro string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_ingest_estado
			(id, ultimo_ciclo_em, rodadas, clubes_ok, clubes_falhos, partidas_novas,
			 snapshots, bootstrap_feito, ultimo_erro, ultimo_erro_em)
		VALUES (1, now(), $1, $2, $3, $4, $5, $6, $7,
		        CASE WHEN $7 = '' THEN NULL ELSE now() END)
		ON CONFLICT (id) DO UPDATE SET
			ultimo_ciclo_em = now(),
			rodadas = EXCLUDED.rodadas,
			clubes_ok = EXCLUDED.clubes_ok,
			clubes_falhos = EXCLUDED.clubes_falhos,
			partidas_novas = EXCLUDED.partidas_novas,
			snapshots = EXCLUDED.snapshots,
			bootstrap_feito = EXCLUDED.bootstrap_feito,
			ultimo_erro = EXCLUDED.ultimo_erro,
			ultimo_erro_em = CASE WHEN EXCLUDED.ultimo_erro = '' THEN clubs_ingest_estado.ultimo_erro_em ELSE now() END`,
		rodadas, ok, falhos, novas, snapshots, bootstrap, ultimoErro)
	if err != nil {
		return fmt.Errorf("save ingest estado: %w", err)
	}
	return nil
}
