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
	source, occurred_at, created_at, external_id, of_account_id, counterparty, external_category, description, inactive`

func scanFinanceTx(row pgx.Row) (domainfinance.Transaction, error) {
	var (
		t             domainfinance.Transaction
		amountDecimal string
		externalID    *string
		ofAccountID   *string
	)
	if err := row.Scan(&t.ID, &t.UserID, &t.AccountID, &t.Type, &amountDecimal,
		&t.Amount.Currency, &t.Category, &t.Source, &t.OccurredAt, &t.CreatedAt,
		&externalID, &ofAccountID, &t.Counterparty, &t.ExternalCategory, &t.Description, &t.Inactive); err != nil {
		return domainfinance.Transaction{}, err
	}
	// amount vem como texto (`amount::text`) para NÃO passar por float no
	// driver; o parse é exato, o mesmo da borda.
	money, err := domainfinance.ParseMoney(amountDecimal, t.Amount.Currency)
	if err != nil {
		return domainfinance.Transaction{}, fmt.Errorf("parse stored amount %q: %w", amountDecimal, err)
	}
	t.Amount = money
	if externalID != nil {
		t.ExternalID = *externalID
	}
	if ofAccountID != nil {
		t.OFAccountID = *ofAccountID
	}
	return t, nil
}

// Insert grava a transação, idempotente por id (o command_id). Devolve false
// quando já existia — a segunda entrega do mesmo comando é no-op.
//
// Para transações do Open Finance o id é gerado pelo worker a partir do
// (source, external_id), então o ON CONFLICT (id) já cobre; o índice único
// parcial em (source, external_id) é a segunda barreira, caso um producer
// futuro use outro id.
func (r *FinanceRepository) Insert(ctx context.Context, t domainfinance.Transaction) (bool, error) {
	// Open Finance: o re-sync ATUALIZA o enriquecimento (categoria/lugar/
	// descrição), porque o provedor melhora esses campos depois (o
	// counterparty só aparece após o job de enrichment). Sem isso, a primeira
	// importação congelava uma categoria pior para sempre — e uma correção do
	// nosso mapeamento nunca chegaria ao que já foi importado.
	//
	// Um lançamento manual (sem external_id) continua DO NOTHING: o id dele é
	// o command_id, e reentregar o mesmo comando não pode mexer no registro.
	conflict := "ON CONFLICT (id) DO NOTHING"
	if t.ExternalID != "" {
		conflict = `ON CONFLICT (id) DO UPDATE SET
			category = EXCLUDED.category,
			counterparty = EXCLUDED.counterparty,
			external_category = EXCLUDED.external_category,
			description = EXCLUDED.description,
			of_account_id = EXCLUDED.of_account_id`
	}
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO finance_transactions
			(id, user_id, account_id, type, amount, currency, category, source, occurred_at, command_id,
			 external_id, of_account_id, counterparty, external_category, description)
		VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$1,
		        NULLIF($10,''), NULLIF($11,'')::uuid, $12, $13, $14)
		`+conflict,
		t.ID, t.UserID, t.AccountID, string(t.Type), t.Amount.Decimal(), t.Amount.Currency,
		t.Category, t.Source, t.OccurredAt,
		t.ExternalID, t.OFAccountID, t.Counterparty, t.ExternalCategory, t.Description)
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

// UpdateTransaction aplica a correção do dono. O user_id no WHERE é a segunda
// barreira da posse: o Service já verificou por leitura, e a query garante que
// nenhum UPDATE toca linha de outro user (§3.4 nº3) mesmo sob corrida.
func (r *FinanceRepository) UpdateTransaction(ctx context.Context, t domainfinance.Transaction) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE finance_transactions SET
			type = $3, amount = $4::numeric, currency = $5, category = $6,
			counterparty = $7, description = $8, occurred_at = $9
		WHERE id = $1 AND user_id = $2
	`, t.ID, t.UserID, string(t.Type), t.Amount.Decimal(), t.Amount.Currency,
		t.Category, t.Counterparty, t.Description, t.OccurredAt)
	if err != nil {
		return fmt.Errorf("update transaction: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainfinance.ErrNotFound
	}
	return nil
}

// RemoveTransaction apaga o lançamento do dono. false = não existia para ESTE
// user (id de outro user responde igual — não vaza existência).
func (r *FinanceRepository) RemoveTransaction(ctx context.Context, id, userID string) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM finance_transactions WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, fmt.Errorf("remove transaction: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// SetTransactionActive alterna a flag de inativa (movimentação entre contas
// próprias). O user_id no WHERE é a segunda barreira da posse.
func (r *FinanceRepository) SetTransactionActive(ctx context.Context, id, userID string, active bool) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE finance_transactions SET inactive = $3 WHERE id = $1 AND user_id = $2`,
		id, userID, !active)
	if err != nil {
		return fmt.Errorf("set transaction active: %w", err)
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

// --------------------------------------------------------------- Open Finance

// UpsertConsent grava/atualiza o consentimento por polp_consent_id. Idempotente:
// reprocessar o mesmo consentimento atualiza os campos em vez de empilhar.
func (r *FinanceRepository) UpsertConsent(ctx context.Context, c domainfinance.Consent) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO finance_of_consents
			(id, polp_consent_id, user_id, institution_id, institution_name, status,
			 execution_status, products, url_to_authenticate, url_expires_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())
		ON CONFLICT (polp_consent_id) DO UPDATE SET
			status = EXCLUDED.status,
			execution_status = EXCLUDED.execution_status,
			institution_name = EXCLUDED.institution_name,
			url_to_authenticate = EXCLUDED.url_to_authenticate,
			url_expires_at = EXCLUDED.url_expires_at,
			updated_at = now()`,
		c.ID, c.PolpConsentID, c.UserID, c.InstitutionID, c.InstitutionName, string(c.Status),
		c.ExecutionStatus, c.Products, c.URLToAuthenticate, nullableTime(c.URLExpiresAt))
	if err != nil {
		return fmt.Errorf("upsert consent: %w", err)
	}
	return nil
}

func (r *FinanceRepository) UpdateConsentStatus(ctx context.Context, polpConsentID string, status domainfinance.ConsentStatus, executionStatus string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE finance_of_consents
		SET status = $2, execution_status = $3, updated_at = now()
		WHERE polp_consent_id = $1`,
		polpConsentID, string(status), executionStatus)
	if err != nil {
		return fmt.Errorf("update consent status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domainfinance.ErrNotFound
	}
	return nil
}

// UpsertOFAccount grava/atualiza a conta importada por polp_account_id. O saldo
// pode vir vazio (ainda não sincronizado) — nesse caso mantém o anterior.
func (r *FinanceRepository) UpsertOFAccount(ctx context.Context, a domainfinance.OFAccount) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO finance_of_accounts
			(id, polp_account_id, polp_consent_id, user_id, name, type, currency,
			 balance_amount, balance_updated_at, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7, NULLIF($8,'')::numeric,
		        $9, now(), now())
		ON CONFLICT (polp_account_id) DO UPDATE SET
			polp_consent_id = EXCLUDED.polp_consent_id,
			name = EXCLUDED.name,
			type = EXCLUDED.type,
			currency = EXCLUDED.currency,
			balance_amount = COALESCE(EXCLUDED.balance_amount, finance_of_accounts.balance_amount),
			balance_updated_at = COALESCE(EXCLUDED.balance_updated_at, finance_of_accounts.balance_updated_at),
			updated_at = now()`,
		a.ID, a.PolpAccountID, a.PolpConsentID, a.UserID, a.Name, a.Type, a.Currency,
		a.BalanceAmount, nullableTime(a.BalanceUpdatedAt))
	if err != nil {
		return fmt.Errorf("upsert of account: %w", err)
	}
	return nil
}

// RemoveConsent apaga a conexão e as contas importadas dela, numa transação.
// As transações importadas NÃO são apagadas (são lançamentos do ledger, com
// auditoria); o vínculo of_account_id vira órfão, o que é aceitável — o
// histórico do que entrou pelo banco permanece.
func (r *FinanceRepository) RemoveConsent(ctx context.Context, polpConsentID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin remove consent: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM finance_of_accounts WHERE polp_consent_id = $1`, polpConsentID); err != nil {
		return fmt.Errorf("delete of accounts: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM finance_of_consents WHERE polp_consent_id = $1`, polpConsentID); err != nil {
		return fmt.Errorf("delete consent: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit remove consent: %w", err)
	}
	return nil
}

// ------------------------------------------------------------- Notificações

func (r *FinanceRepository) UpsertNotification(ctx context.Context, n domainfinance.Notification) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO finance_notifications (id, user_id, kind, category, threshold, channel, enabled, created_at, updated_at)
		VALUES ($1,$2,$3,$4, NULLIF($5,'')::numeric, $6, $7, now(), now())
		ON CONFLICT (id) DO UPDATE SET
			kind = EXCLUDED.kind, category = EXCLUDED.category,
			threshold = EXCLUDED.threshold, channel = EXCLUDED.channel,
			enabled = EXCLUDED.enabled, updated_at = now()`,
		n.ID, n.UserID, n.Kind, n.Category, n.Threshold, n.Channel, n.Enabled)
	if err != nil {
		return fmt.Errorf("upsert notification: %w", err)
	}
	return nil
}

func (r *FinanceRepository) DeleteNotification(ctx context.Context, userID, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM finance_notifications WHERE user_id = $1 AND id = $2`, userID, id)
	if err != nil {
		return fmt.Errorf("delete notification: %w", err)
	}
	return nil
}

// UpsertInvestment grava/atualiza a posição de investimento por polp_invest_id.
func (r *FinanceRepository) UpsertInvestment(ctx context.Context, i domainfinance.Investment) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO finance_investments
			(id, user_id, polp_consent_id, polp_invest_id, institution_name, type, name,
			 currency, invested_amount, gross_amount, yield_percent, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::numeric,$11,$12)
		ON CONFLICT (polp_invest_id) DO UPDATE SET
			institution_name = EXCLUDED.institution_name,
			type = EXCLUDED.type,
			name = EXCLUDED.name,
			invested_amount = EXCLUDED.invested_amount,
			gross_amount = EXCLUDED.gross_amount,
			yield_percent = EXCLUDED.yield_percent,
			updated_at = EXCLUDED.updated_at`,
		i.ID, i.UserID, i.PolpConsentID, i.PolpInvestID, i.InstitutionName, i.Type, i.Name,
		i.Currency, i.InvestedAmount.Decimal(), i.GrossAmount.Decimal(), i.YieldPercent, i.UpdatedAt)
	if err != nil {
		return fmt.Errorf("upsert investment: %w", err)
	}
	return nil
}
