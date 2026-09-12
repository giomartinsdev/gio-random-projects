package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativo"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/ativomovimento"
)

// AtivoRepository implements domain/ativo.Repository against Postgres --
// the only adapter that satisfies that port. Insert and InsertMovimento
// each write both the ativos row and its ativo_movimentos row inside
// one SQL transaction: neither is a complete, consistent state without
// the other (an Ativo with no movimento history, or a movimento
// against a position that was never updated to match it).
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
	err := row.Scan(&a.ID, &a.UsuarioEmail, &a.ContaID, &a.Ticker, &a.QuantidadeAtual, &a.CustoMedio, &ultimaCotacao, &ultimaCotacaoEm, &a.Status, &a.CriadoEm, &a.AtualizadoEm)
	if ultimaCotacao != nil {
		a.UltimaCotacao = *ultimaCotacao
	}
	if ultimaCotacaoEm != nil {
		a.UltimaCotacaoEm = *ultimaCotacaoEm
	}
	return a, err
}

const movimentoColumns = `id, ativo_id, tipo, quantidade, preco_unitario, valor_provento, data, resultado_realizado, criado_em`

func scanMovimento(row pgx.Row) (ativomovimento.AtivoMovimento, error) {
	var m ativomovimento.AtivoMovimento
	var quantidade, precoUnitario, valorProvento, resultadoRealizado *float64
	err := row.Scan(&m.ID, &m.AtivoID, &m.Tipo, &quantidade, &precoUnitario, &valorProvento, &m.Data, &resultadoRealizado, &m.CriadoEm)
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

// ListByUsuario returns every ativo the usuario holds, optionally
// scoped to one conta -- an empty contaID means "todas", same
// "empty = no filter" convention as ContaRepository.ListByUsuario.
func (r *AtivoRepository) ListByUsuario(ctx context.Context, usuarioEmail, contaID string) ([]domainativo.Ativo, error) {
	var rows pgx.Rows
	var err error
	if contaID == "" {
		rows, err = r.pool.Query(ctx,
			`SELECT `+ativoColumns+` FROM ativos WHERE usuario_email = $1 ORDER BY criado_em DESC`, usuarioEmail)
	} else {
		rows, err = r.pool.Query(ctx,
			`SELECT `+ativoColumns+` FROM ativos WHERE usuario_email = $1 AND conta_id = $2 ORDER BY criado_em DESC`,
			usuarioEmail, contaID)
	}
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

// Insert writes a brand-new Ativo and the compra movimento that funded
// it in one transaction -- an Ativo row with no movimento (or vice
// versa) would be an inconsistent state no reader should ever observe.
func (r *AtivoRepository) Insert(ctx context.Context, a domainativo.Ativo, primeiroMovimento ativomovimento.AtivoMovimento) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin insert ativo: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO ativos (id, usuario_email, conta_id, ticker, quantidade_atual, custo_medio, status, criado_em, atualizado_em)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		a.ID, a.UsuarioEmail, a.ContaID, a.Ticker, a.QuantidadeAtual, a.CustoMedio, a.Status, a.CriadoEm, a.AtualizadoEm,
	); err != nil {
		return fmt.Errorf("insert ativo: %w", err)
	}

	if err := insertMovimentoTx(ctx, tx, primeiroMovimento); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit insert ativo: %w", err)
	}
	return nil
}

// InsertMovimento persists a new movimento and the Ativo's updated
// running position together -- same "both sides or neither" reasoning
// as Insert.
func (r *AtivoRepository) InsertMovimento(ctx context.Context, a domainativo.Ativo, mov ativomovimento.AtivoMovimento) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin insert movimento: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx,
		`UPDATE ativos SET quantidade_atual = $2, custo_medio = $3, status = $4, atualizado_em = $5 WHERE id = $1`,
		a.ID, a.QuantidadeAtual, a.CustoMedio, a.Status, a.AtualizadoEm,
	)
	if err != nil {
		return fmt.Errorf("update ativo position: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainativo.ErrNotFound
	}

	if err := insertMovimentoTx(ctx, tx, mov); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit insert movimento: %w", err)
	}
	return nil
}

func insertMovimentoTx(ctx context.Context, tx pgx.Tx, mov ativomovimento.AtivoMovimento) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO ativo_movimentos (id, ativo_id, tipo, quantidade, preco_unitario, valor_provento, data, resultado_realizado, criado_em)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		mov.ID, mov.AtivoID, mov.Tipo, nullifyFloat(mov.Quantidade), nullifyFloat(mov.PrecoUnitario), nullifyFloat(mov.ValorProvento), mov.Data, nullifyFloat(mov.ResultadoRealizado), mov.CriadoEm,
	)
	if err != nil {
		return fmt.Errorf("insert ativo movimento: %w", err)
	}
	return nil
}

// UpdateCotacao goes straight at Postgres without touching the
// aggregate's other fields -- a quote refresh is not part of
// RegistrarMovimento's business rule (see application/ativo.Service).
func (r *AtivoRepository) UpdateCotacao(ctx context.Context, ativoID string, cotacao float64, obtidaEm time.Time) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE ativos SET ultima_cotacao = $2, ultima_cotacao_em = $3, atualizado_em = now() WHERE id = $1`,
		ativoID, cotacao, obtidaEm,
	)
	if err != nil {
		return fmt.Errorf("update ativo cotacao: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainativo.ErrNotFound
	}
	return nil
}

func (r *AtivoRepository) ListMovimentos(ctx context.Context, ativoID string) ([]ativomovimento.AtivoMovimento, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+movimentoColumns+` FROM ativo_movimentos WHERE ativo_id = $1 ORDER BY data DESC, criado_em DESC`, ativoID)
	if err != nil {
		return nil, fmt.Errorf("list ativo movimentos: %w", err)
	}
	defer rows.Close()

	var movimentos []ativomovimento.AtivoMovimento
	for rows.Next() {
		m, err := scanMovimento(rows)
		if err != nil {
			return nil, fmt.Errorf("scan ativo movimento: %w", err)
		}
		movimentos = append(movimentos, m)
	}
	return movimentos, rows.Err()
}

// nullifyFloat turns a zero value into SQL NULL -- ativo_movimentos'
// quantidade/preco_unitario/valor_provento/resultado_realizado columns
// are all nullable, and 0 legitimately means "not applicable to this
// tipo" (a provento has no quantidade, a compra/venda has no
// valor_provento) rather than a real zero amount.
func nullifyFloat(f float64) *float64 {
	if f == 0 {
		return nil
	}
	return &f
}
