package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SearchRunRepository guards clubs_search_runs: a fila de busca ao vivo na
// fonte, escrita pela tela de resgate e consumida pelo worker de ingestão.
//
// A busca do diretório é local (rápida, só o que o hub já viu). Esta fila é a
// saída para um clube que ainda não está na base: o worker consulta a fonte e
// grava o que achar, e a SPA polla até o resultado aparecer.
type SearchRunRepository struct {
	pool *pgxpool.Pool
}

func NewSearchRunRepository(pool *pgxpool.Pool) *SearchRunRepository {
	return &SearchRunRepository{pool: pool}
}

// Save é upsert pelo termo normalizado. Idempotente: buscar duas vezes a mesma
// coisa não duplica trabalho -- o segundo pedido só reabre a linha.
func (r *SearchRunRepository) Save(ctx context.Context, termo string, rodando bool,
	encontrados int, erro string, concluido bool) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO clubs_search_runs (termo, rodando, encontrados, erro, solicitado_em, concluido_em)
		VALUES ($1, $2, $3, $4, now(), CASE WHEN $5 THEN now() ELSE NULL END)
		ON CONFLICT (termo) DO UPDATE SET
			rodando = EXCLUDED.rodando,
			encontrados = EXCLUDED.encontrados,
			erro = EXCLUDED.erro,
			concluido_em = EXCLUDED.concluido_em`,
		termo, rodando, encontrados, erro, concluido)
	if err != nil {
		return fmt.Errorf("save search run: %w", err)
	}
	return nil
}
