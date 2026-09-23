package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainativomovimento "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/ativomovimento"
)

// AtivoMovimentoRepository implements domain/ativomovimento.Repository
// -- read-only, matching what domain-api actually does with it.
type AtivoMovimentoRepository struct {
	pool *pgxpool.Pool
}

func NewAtivoMovimentoRepository(pool *pgxpool.Pool) *AtivoMovimentoRepository {
	return &AtivoMovimentoRepository{pool: pool}
}

const ativoMovimentoColumns = `id, ativo_id, kind, quantidade, preco_unitario, valor_provento, data, resultado_realizado, created_at`

func scanAtivoMovimento(row pgx.Row) (domainativomovimento.AtivoMovimento, error) {
	var m domainativomovimento.AtivoMovimento
	var quantidade, precoUnitario, valorProvento, resultadoRealizado *float64
	err := row.Scan(
		&m.ID, &m.AtivoID, &m.Kind, &quantidade, &precoUnitario, &valorProvento, &m.Data, &resultadoRealizado, &m.CreatedAt,
	)
	if quantidade != nil {
		m.Quantidade = *quantidade
	}
	if precoUnitario != nil {
		m.PrecoUnitario = *precoUnitario
	}
	if valorProvento != nil {
		m.ValorProvento = *valorProvento
	}
	if resultadoRealizado != nil {
		m.ResultadoRealizado = *resultadoRealizado
	}
	return m, err
}

func (r *AtivoMovimentoRepository) ListByAtivo(ctx context.Context, ativoID string) ([]domainativomovimento.AtivoMovimento, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+ativoMovimentoColumns+` FROM ativo_movimentos WHERE ativo_id = $1 ORDER BY data DESC, created_at DESC`,
		ativoID,
	)
	if err != nil {
		return nil, fmt.Errorf("list ativo movimentos: %w", err)
	}
	defer rows.Close()

	var movimentos []domainativomovimento.AtivoMovimento
	for rows.Next() {
		m, err := scanAtivoMovimento(rows)
		if err != nil {
			return nil, fmt.Errorf("scan ativo movimento: %w", err)
		}
		movimentos = append(movimentos, m)
	}
	return movimentos, rows.Err()
}
