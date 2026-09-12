package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/ativo"
)

// AtivoRepository implements domain/ativo.Repository -- read-only,
// matching what domain-api actually does with it.
type AtivoRepository struct {
	pool *pgxpool.Pool
}

func NewAtivoRepository(pool *pgxpool.Pool) *AtivoRepository {
	return &AtivoRepository{pool: pool}
}

const ativoColumns = `id, usuario_email, conta_id, ticker, quantidade_atual, custo_medio, ultima_cotacao, ultima_cotacao_em, status, criado_em, atualizado_em`

func scanAtivo(row pgx.Row) (domainativo.Ativo, error) {
	var a domainativo.Ativo
	var ultimaCotacao *float64
	var ultimaCotacaoEm *time.Time
	err := row.Scan(
		&a.ID, &a.UsuarioEmail, &a.ContaID, &a.Ticker, &a.QuantidadeAtual, &a.CustoMedio,
		&ultimaCotacao, &ultimaCotacaoEm, &a.Status, &a.CriadoEm, &a.AtualizadoEm,
	)
	if ultimaCotacao != nil {
		a.UltimaCotacao = *ultimaCotacao
	}
	if ultimaCotacaoEm != nil {
		a.UltimaCotacaoEm = *ultimaCotacaoEm
	}
	return a, err
}

func (r *AtivoRepository) FindByID(ctx context.Context, id string) (domainativo.Ativo, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+ativoColumns+` FROM ativos WHERE id = $1`, id)
	a, err := scanAtivo(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainativo.Ativo{}, domainativo.ErrNotFound
	}
	if err != nil {
		return domainativo.Ativo{}, fmt.Errorf("find ativo: %w", err)
	}
	return a, nil
}

// An empty contaID means "every conta of this usuario".
func (r *AtivoRepository) ListByUsuario(ctx context.Context, usuarioEmail, contaID string) ([]domainativo.Ativo, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+ativoColumns+` FROM ativos
		 WHERE usuario_email = $1 AND ($2 = '' OR conta_id = $2::uuid)
		 ORDER BY criado_em DESC`,
		usuarioEmail, contaID,
	)
	if err != nil {
		return nil, fmt.Errorf("list ativos: %w", err)
	}
	defer rows.Close()

	var ativos []domainativo.Ativo
	for rows.Next() {
		a, err := scanAtivo(rows)
		if err != nil {
			return nil, fmt.Errorf("scan ativo: %w", err)
		}
		ativos = append(ativos, a)
	}
	return ativos, rows.Err()
}
