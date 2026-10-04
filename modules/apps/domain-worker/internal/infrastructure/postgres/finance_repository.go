package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/finance"
)

// FinanceRepository implements domain/finance.Repository against Postgres.
// É o único escritor das tabelas finance_* (§1.1: a finance-api é ACL e não tem
// banco; o worker conversacional só fala HTTP).
type FinanceRepository struct {
	pool *pgxpool.Pool
}

func NewFinanceRepository(pool *pgxpool.Pool) *FinanceRepository {
	return &FinanceRepository{pool: pool}
}

const financeTxColumns = `id, user_id, account_id, type, amount::text, currency, category,
	source, occurred_at, created_at`

func scanFinanceTx(row pgx.Row) (domainfinance.Transaction, error) {
	var (
		t             domainfinance.Transaction
		amountDecimal string
	)
	if err := row.Scan(&t.ID, &t.UserID, &t.AccountID, &t.Type, &amountDecimal,
		&t.Amount.Currency, &t.Category, &t.Source, &t.OccurredAt, &t.CreatedAt); err != nil {
		return domainfinance.Transaction{}, err
	}
	// amount vem como texto (`amount::text`) para NÃO passar por float no
	// driver; o parse é exato, o mesmo da borda.
	money, err := domainfinance.ParseMoney(amountDecimal, t.Amount.Currency)
	if err != nil {
		return domainfinance.Transaction{}, fmt.Errorf("parse stored amount %q: %w", amountDecimal, err)
	}
	t.Amount = money
	return t, nil
}

// Insert grava a transação, idempotente por id (o command_id). Devolve false
// quando já existia — a segunda entrega do mesmo comando é no-op.
func (r *FinanceRepository) Insert(ctx context.Context, t domainfinance.Transaction) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO finance_transactions
			(id, user_id, account_id, type, amount, currency, category, source, occurred_at, command_id)
		VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$1)
		ON CONFLICT (id) DO NOTHING`,
		t.ID, t.UserID, t.AccountID, string(t.Type), t.Amount.Decimal(), t.Amount.Currency,
		t.Category, t.Source, t.OccurredAt)
	if err != nil {
		return false, fmt.Errorf("insert transaction: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

func (r *FinanceRepository) FindByID(ctx context.Context, id string) (domainfinance.Transaction, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+financeTxColumns+` FROM finance_transactions WHERE id = $1`, id)
	t, err := scanFinanceTx(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainfinance.Transaction{}, domainfinance.ErrNotFound
	}
	if err != nil {
		return domainfinance.Transaction{}, fmt.Errorf("find transaction: %w", err)
	}
	return t, nil
}

func (r *FinanceRepository) UpdateCategory(ctx context.Context, id, category string) error {
	tag, err := r.pool.Exec(ctx, `UPDATE finance_transactions SET category = $2 WHERE id = $1`, id, category)
	if err != nil {
		return fmt.Errorf("update category: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainfinance.ErrNotFound
	}
	return nil
}

// InsertTransfer grava débito + crédito numa única transação SQL (§3.4 nº2:
// ou os dois entram, ou nenhum). As duas linhas compartilham transfer_id.
func (r *FinanceRepository) InsertTransfer(ctx context.Context, debit, credit domainfinance.Transaction) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transfer tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	transferID := debit.ID // o id do débito identifica o par
	insert := func(t domainfinance.Transaction) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO finance_transactions
				(id, user_id, account_id, type, amount, currency, category, source, occurred_at, command_id, transfer_id)
			VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$1,$10)
			ON CONFLICT (id) DO NOTHING`,
			t.ID, t.UserID, t.AccountID, string(t.Type), t.Amount.Decimal(), t.Amount.Currency,
			t.Category, t.Source, t.OccurredAt, transferID)
		if err != nil {
			return fmt.Errorf("insert transfer leg: %w", err)
		}
		return nil
	}
	// Débito primeiro, crédito depois; qualquer erro derruba os dois.
	if err := insert(debit); err != nil {
		return err
	}
	if err := insert(credit); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transfer tx: %w", err)
	}
	return nil
}

// UpsertBudget grava/atualiza o orçamento e devolve o id ESTÁVEL da linha —
// em conflito, o id já existente (não o recém-gerado), senão a régua mudaria
// de chave a cada avaliação e nunca seria "uma vez por limiar" (§3.4 nº5).
func (r *FinanceRepository) UpsertBudget(ctx context.Context, b domainfinance.Budget) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO finance_budgets (id, user_id, category, limit_amount, currency, period)
		VALUES ($1,$2,$3,$4::numeric,$5,$6)
		ON CONFLICT (user_id, category, period)
		DO UPDATE SET limit_amount = EXCLUDED.limit_amount, currency = EXCLUDED.currency
		RETURNING id`,
		b.ID, b.UserID, b.Category, b.Limit.Decimal(), b.Limit.Currency, b.Period).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("upsert budget: %w", err)
	}
	return id, nil
}

// RecordThreshold grava o disparo e devolve false quando já existia para
// (budget, threshold, period) — a garantia de "uma vez por limiar" (§3.4 nº5).
func (r *FinanceRepository) RecordThreshold(ctx context.Context, b domainfinance.Budget, threshold int, period, spent, limit string) (bool, error) {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO finance_budget_thresholds
			(budget_id, threshold, period, spent_amount, limit_amount, currency)
		VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6)
		ON CONFLICT (budget_id, threshold, period) DO NOTHING`,
		b.ID, threshold, period, spent, limit, b.Limit.Currency)
	if err != nil {
		return false, fmt.Errorf("record threshold: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// SumSpent soma os gastos (EXPENSE, amount negativo é o débito) de uma
// categoria num período, em centavos. Devolve o valor absoluto do gasto.
func (r *FinanceRepository) SumSpent(ctx context.Context, userID, category, period string) (int64, error) {
	var total string
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount),0)::text FROM finance_transactions
		WHERE user_id = $1 AND category = $2 AND type = 'EXPENSE'
		  AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $3`,
		userID, category, period).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("sum spent: %w", err)
	}
	money, err := domainfinance.ParseMoney(total, "BRL")
	if err != nil {
		return 0, fmt.Errorf("parse spent %q: %w", total, err)
	}
	if money.Cents < 0 {
		return -money.Cents, nil
	}
	return money.Cents, nil
}
