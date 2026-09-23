package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domaintransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/transacao"
)

// TransacaoRepository implements domain/transacao.Repository against
// Postgres -- the only adapter that satisfies that port.
type TransacaoRepository struct {
	pool *pgxpool.Pool
}

func NewTransacaoRepository(pool *pgxpool.Pool) *TransacaoRepository {
	return &TransacaoRepository{pool: pool}
}

const transacaoColumns = `id, usuario_email, conta_id, tipo, valor, data, categoria, descricao, anexo_imagem, criado_em, atualizado_em`

func scanTransacao(row pgx.Row) (domaintransacao.Transacao, error) {
	var t domaintransacao.Transacao
	var descricao, anexoImagem *string
	err := row.Scan(&t.ID, &t.UsuarioEmail, &t.ContaID, &t.Tipo, &t.Valor, &t.Data, &t.Categoria, &descricao, &anexoImagem, &t.CriadoEm, &t.AtualizadoEm)
	if descricao != nil {
		t.Descricao = *descricao
	}
	if anexoImagem != nil {
		t.AnexoImagem = *anexoImagem
	}
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

// ListByFiltro applies every filter that was actually given -- contaID,
// categoria, de and ate are all optional beyond the required
// usuarioEmail, same "nil/empty = no filter" convention as
// ContaRepository.ListByUsuario's status argument.
func (r *TransacaoRepository) ListByFiltro(ctx context.Context, usuarioEmail, contaID, categoria string, de, ate *time.Time) ([]domaintransacao.Transacao, error) {
	query := `SELECT ` + transacaoColumns + ` FROM transacoes WHERE usuario_email = $1`
	args := []any{usuarioEmail}

	if contaID != "" {
		args = append(args, contaID)
		query += fmt.Sprintf(" AND conta_id = $%d", len(args))
	}
	if categoria != "" {
		args = append(args, categoria)
		query += fmt.Sprintf(" AND categoria = $%d", len(args))
	}
	if de != nil {
		args = append(args, *de)
		query += fmt.Sprintf(" AND data >= $%d", len(args))
	}
	if ate != nil {
		args = append(args, *ate)
		query += fmt.Sprintf(" AND data <= $%d", len(args))
	}
	query += " ORDER BY data DESC, criado_em DESC"

	rows, err := r.pool.Query(ctx, query, args...)
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

func (r *TransacaoRepository) Insert(ctx context.Context, t domaintransacao.Transacao) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO transacoes (id, usuario_email, conta_id, tipo, valor, data, categoria, descricao, anexo_imagem, criado_em, atualizado_em)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		t.ID, t.UsuarioEmail, t.ContaID, t.Tipo, t.Valor, t.Data, t.Categoria, nullify(t.Descricao), nullify(t.AnexoImagem), t.CriadoEm, t.AtualizadoEm,
	)
	if err != nil {
		return fmt.Errorf("insert transacao: %w", err)
	}
	return nil
}

func (r *TransacaoRepository) Update(ctx context.Context, t domaintransacao.Transacao) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE transacoes SET tipo = $2, valor = $3, data = $4, categoria = $5, descricao = $6, anexo_imagem = $7, atualizado_em = $8 WHERE id = $1`,
		t.ID, t.Tipo, t.Valor, t.Data, t.Categoria, nullify(t.Descricao), nullify(t.AnexoImagem), t.AtualizadoEm,
	)
	if err != nil {
		return fmt.Errorf("update transacao: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domaintransacao.ErrNotFound
	}
	return nil
}

// Delete is a physical DELETE -- transacao has no "arquivar" concept
// (unlike conta), FR-021 allows removing one outright.
func (r *TransacaoRepository) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM transacoes WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete transacao: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domaintransacao.ErrNotFound
	}
	return nil
}

// nullify turns an empty string into a nil *string so an optional
// TEXT column stores SQL NULL instead of an empty string -- descricao
// and anexo_imagem are both nullable columns.
func nullify(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
