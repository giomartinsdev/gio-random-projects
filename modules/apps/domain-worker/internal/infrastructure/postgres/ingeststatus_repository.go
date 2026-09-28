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
//
// `sourceAvailable` é a saúde da FONTE, distinta do `lastError` do ciclo: um
// erro pode ser de um clube só, enquanto source_available=false é a fonte
// inteira recusando. A interface usa esse booleano para avisar que há
// dificuldade de falar com a fornecedora dos dados.
func (r *IngestEstadoRepository) Save(ctx context.Context, cycles, ok, falhos, novas, snapshots int,
	bootstrap bool, lastError string, sourceAvailable bool, sourceError string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_ingest_estado
			(id, last_cycle_at, cycles, clubs_ok, clubs_failed, new_matches,
			 snapshots, bootstrapped, last_error, last_error_at, source_available, source_error)
		VALUES (1, now(), $1, $2, $3, $4, $5, $6, $7,
		        CASE WHEN $7 = '' THEN NULL ELSE now() END, $8, $9)
		ON CONFLICT (id) DO UPDATE SET
			last_cycle_at = now(),
			cycles = EXCLUDED.cycles,
			clubs_ok = EXCLUDED.clubs_ok,
			clubs_failed = EXCLUDED.clubs_failed,
			new_matches = EXCLUDED.new_matches,
			snapshots = EXCLUDED.snapshots,
			bootstrapped = EXCLUDED.bootstrapped,
			last_error = EXCLUDED.last_error,
			last_error_at = CASE WHEN EXCLUDED.last_error = '' THEN clubs_ingest_estado.last_error_at ELSE now() END,
			source_available = EXCLUDED.source_available,
			source_error = EXCLUDED.source_error`,
		cycles, ok, falhos, novas, snapshots, bootstrap, lastError, sourceAvailable, sourceError)
	if err != nil {
		return fmt.Errorf("save ingest estado: %w", err)
	}
	return nil
}
