package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domaintransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/transacao"
)

// TransacaoRepository implements domain/transacao.Repository --
// read-only, matching what domain-api actually does with it.
type TransacaoRepository struct {
	pool *pgxpool.Pool
}

func NewTransacaoRepository(pool *pgxpool.Pool) *TransacaoRepository {
	return &TransacaoRepository{pool: pool}
}

const transacaoColumns = `id, usuario_email, conta_id, tipo, categoria, descricao, anexo_imagem, valor, data, criado_em, atualizado_em`

func scanTransacao(row pgx.Row) (domaintransacao.Transacao, error) {
	var t domaintransacao.Transacao
	err := row.Scan(
		&t.ID, &t.UsuarioEmail, &t.ContaID, &t.Tipo, &t.Categoria, &t.Descricao, &t.AnexoImagem,
		&t.Valor, &t.Data, &t.CriadoEm, &t.AtualizadoEm,
	)
	return t, err
}

func (r *TransacaoRepository) FindByID(ctx context.Context, id string) (domaintransacao.Transacao, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+transacaoColumns+` FROM transacoes WHERE id = $1`, id)
	t, err := scanTransacao(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domaintransacao.Transacao{}, domaintransacao.ErrNotFound
	}
	if err != nil {
		return domaintransacao.Transacao{}, fmt.Errorf("find transacao: %w", err)
	}
	return t, nil
}

// Empty contaID/categoria mean "any"; nil de/ate mean "unbounded" on
// that side of the range -- every filter collapses out in SQL rather
// than needing conditional query building.
func (r *TransacaoRepository) ListByFiltro(ctx context.Context, usuarioEmail, contaID, categoria string, de, ate *time.Time) ([]domaintransacao.Transacao, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+transacaoColumns+` FROM transacoes
		 WHERE usuario_email = $1
		   AND ($2 = '' OR conta_id = $2::uuid)
		   AND ($3 = '' OR categoria = $3)
		   AND ($4::date IS NULL OR data >= $4::date)
		   AND ($5::date IS NULL OR data <= $5::date)
		 ORDER BY data DESC, criado_em DESC`,
		usuarioEmail, contaID, categoria, de, ate,
	)
	if err != nil {
		return nil, fmt.Errorf("list transacoes: %w", err)
	}
	defer rows.Close()

	var transacoes []domaintransacao.Transacao
	for rows.Next() {
		t, err := scanTransacao(rows)
		if err != nil {
			return nil, fmt.Errorf("scan transacao: %w", err)
		}
		transacoes = append(transacoes, t)
	}
	return transacoes, rows.Err()
}
