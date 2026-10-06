package postgres

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/finance"
)

// FinanceReadRepository implements domain/finance.ReadRepository against
// Postgres. Read-only, matching what domain-api actually does with the finance
// tables: all aggregation happens here in SQL rather than being materialized —
// at this scale a query beats an invalidation policy (same choice as
// ClubsRepository).
//
// Every money column is selected `::text` so it never passes through a float
// in the driver; the canonical decimal string is carried to the wire verbatim
// (§3.4 nº1).
type FinanceReadRepository struct {
	pool *pgxpool.Pool
}

func NewFinanceReadRepository(pool *pgxpool.Pool) *FinanceReadRepository {
	return &FinanceReadRepository{pool: pool}
}

// periodClause is the month bucket key used by every monthly query: it must
// match the stored `occurred_at` in UTC (the ledger is always UTC, §3.4 nº4)
// and the Go-side "YYYY-MM" validation on the handler.
const periodClause = `to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $2`

func (r *FinanceReadRepository) DailySummary(ctx context.Context, userID, date string) (domainfinance.DailySummary, error) {
	out := domainfinance.DailySummary{
		UserID:   userID,
		Date:     date,
		Income:   "0.00",
		Expense:  "0.00",
		Net:      "0.00",
		Currency: "BRL",
	}
	err := r.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(amount) FILTER (WHERE type = 'INCOME'), 0)::numeric(14,2)::text,
			COALESCE(SUM(amount) FILTER (WHERE type = 'EXPENSE'), 0)::numeric(14,2)::text,
			COALESCE(SUM(amount), 0)::numeric(14,2)::text,
			COUNT(*)::int
		FROM finance_transactions
		WHERE user_id = $1 AND NOT inactive
		  AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $2`,
		userID, date).Scan(&out.Income, &out.Expense, &out.Net, &out.TransactionCount)
	if err != nil {
		return domainfinance.DailySummary{}, fmt.Errorf("daily summary: %w", err)
	}
	return out, nil
}

// monthTotals is the shared income/expense/net/count aggregation the dashboard
// and the breakdown both need.
func (r *FinanceReadRepository) monthTotals(ctx context.Context, userID, month string) (income, expense, net string, count int, currency string, err error) {
	currency = "BRL"
	err = r.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(amount) FILTER (WHERE type = 'INCOME'), 0)::numeric(14,2)::text,
			COALESCE(SUM(amount) FILTER (WHERE type = 'EXPENSE'), 0)::numeric(14,2)::text,
			COALESCE(SUM(amount), 0)::numeric(14,2)::text,
			COUNT(*)::int
		FROM finance_transactions
		WHERE user_id = $1 AND NOT inactive AND `+periodClause,
		userID, month).Scan(&income, &expense, &net, &count)
	if err != nil {
		return "", "", "", 0, "", fmt.Errorf("month totals: %w", err)
	}
	return income, expense, net, count, currency, nil
}

func (r *FinanceReadRepository) MonthlyDashboard(ctx context.Context, userID, month string) (domainfinance.MonthlyDashboard, error) {
	income, expense, net, count, currency, err := r.monthTotals(ctx, userID, month)
	if err != nil {
		return domainfinance.MonthlyDashboard{}, err
	}
	top, err := r.CategoryBreakdown(ctx, userID, month)
	if err != nil {
		return domainfinance.MonthlyDashboard{}, err
	}
	categories := top.Categories
	if len(categories) > 5 {
		categories = categories[:5]
	}
	budgets, err := r.budgetsForMonth(ctx, userID, month)
	if err != nil {
		return domainfinance.MonthlyDashboard{}, err
	}
	return domainfinance.MonthlyDashboard{
		UserID:           userID,
		Month:            month,
		Income:           income,
		Expense:          expense,
		Net:              net,
		Currency:         currency,
		TransactionCount: count,
		TopCategories:    categories,
		Budgets:          budgets,
	}, nil
}

func (r *FinanceReadRepository) CategoryBreakdown(ctx context.Context, userID, month string) (domainfinance.CategoryBreakdown, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT category, COALESCE(SUM(amount), 0)::numeric(14,2)::text, COUNT(*)::int
		FROM finance_transactions
		WHERE NOT inactive AND user_id = $1 AND type = 'EXPENSE' AND `+periodClause+`
		GROUP BY category
		ORDER BY SUM(amount) ASC, category ASC`,
		userID, month)
	if err != nil {
		return domainfinance.CategoryBreakdown{}, fmt.Errorf("category breakdown: %w", err)
	}
	defer rows.Close()

	categories := make([]domainfinance.CategoryAmount, 0)
	for rows.Next() {
		var c domainfinance.CategoryAmount
		if err := rows.Scan(&c.Category, &c.Amount, &c.TransactionCount); err != nil {
			return domainfinance.CategoryBreakdown{}, fmt.Errorf("scan category: %w", err)
		}
		c.Currency = "BRL"
		categories = append(categories, c)
	}
	if err := rows.Err(); err != nil {
		return domainfinance.CategoryBreakdown{}, fmt.Errorf("iterate categories: %w", err)
	}
	return domainfinance.CategoryBreakdown{
		UserID:     userID,
		Month:      month,
		Currency:   "BRL",
		Categories: categories,
	}, nil
}

// budgetsForMonth returns each budget of the month with what was spent and the
// thresholds that already fired. Spent is summed from EXPENSE rows of the same
// category and period — the same computation SetCategoryBudget uses to decide
// whether to fire, so the dashboard and the alert cannot disagree.
func (r *FinanceReadRepository) budgetsForMonth(ctx context.Context, userID, month string) ([]domainfinance.BudgetStatus, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT b.category, b.limit_amount::text, b.currency,
		       COALESCE(SUM(t.amount), 0)::numeric(14,2)::text
		FROM finance_budgets b
		LEFT JOIN finance_transactions t
		  ON t.user_id = b.user_id
		 AND t.category = b.category
		 AND t.type = 'EXPENSE'
		 AND to_char(t.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = b.period
		WHERE b.user_id = $1 AND b.period = $2
		GROUP BY b.id, b.category, b.limit_amount, b.currency
		ORDER BY b.category ASC`,
		userID, month)
	if err != nil {
		return nil, fmt.Errorf("budgets for month: %w", err)
	}
	defer rows.Close()

	budgets := make([]domainfinance.BudgetStatus, 0)
	for rows.Next() {
		var b domainfinance.BudgetStatus
		if err := rows.Scan(&b.Category, &b.LimitAmount, &b.Currency, &b.SpentAmount); err != nil {
			return nil, fmt.Errorf("scan budget: %w", err)
		}
		b.Thresholds = []int{}
		budgets = append(budgets, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate budgets: %w", err)
	}
	// Second pass, per budget: which thresholds already fired. Kept as a
	// separate small query per budget (there are a handful) rather than a
	// join that would need DISTINCT to avoid duplicating the budget row.
	for i := range budgets {
		fired, err := r.firedThresholds(ctx, userID, budgets[i].Category, month)
		if err != nil {
			return nil, err
		}
		budgets[i].Thresholds = fired
	}
	return budgets, nil
}

func (r *FinanceReadRepository) firedThresholds(ctx context.Context, userID, category, period string) ([]int, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT th.threshold
		FROM finance_budget_thresholds th
		JOIN finance_budgets b ON b.id = th.budget_id
		WHERE b.user_id = $1 AND b.category = $2 AND th.period = $3
		ORDER BY th.threshold ASC`,
		userID, category, period)
	if err != nil {
		return nil, fmt.Errorf("fired thresholds: %w", err)
	}
	defer rows.Close()

	out := []int{}
	for rows.Next() {
		var t int
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("scan threshold: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) CashFlowHistory(ctx context.Context, userID, month string) (domainfinance.CashFlowHistory, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
			COALESCE(SUM(amount) FILTER (WHERE type = 'INCOME'), 0)::numeric(14,2)::text,
			COALESCE(SUM(amount) FILTER (WHERE type = 'EXPENSE'), 0)::numeric(14,2)::text,
			COALESCE(SUM(amount), 0)::numeric(14,2)::text
		FROM finance_transactions
		WHERE user_id = $1 AND NOT inactive AND `+periodClause+`
		GROUP BY day
		ORDER BY day ASC`,
		userID, month)
	if err != nil {
		return domainfinance.CashFlowHistory{}, fmt.Errorf("cash flow history: %w", err)
	}
	defer rows.Close()

	days := make([]domainfinance.CashFlowDay, 0)
	for rows.Next() {
		var d domainfinance.CashFlowDay
		if err := rows.Scan(&d.Date, &d.Income, &d.Expense, &d.Net); err != nil {
			return domainfinance.CashFlowHistory{}, fmt.Errorf("scan cash flow day: %w", err)
		}
		days = append(days, d)
	}
	if err := rows.Err(); err != nil {
		return domainfinance.CashFlowHistory{}, fmt.Errorf("iterate cash flow: %w", err)
	}
	return domainfinance.CashFlowHistory{
		UserID:   userID,
		Month:    month,
		Currency: "BRL",
		Days:     days,
	}, nil
}

// --------------------------------------------------------------- Open Finance

func (r *FinanceReadRepository) OFConsents(ctx context.Context, userID string) (domainfinance.OFConsentList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, polp_consent_id, institution_id, institution_name, status, execution_status,
		       products, url_to_authenticate, updated_at
		FROM finance_of_consents
		WHERE user_id = $1
		ORDER BY updated_at DESC`, userID)
	if err != nil {
		return domainfinance.OFConsentList{}, fmt.Errorf("of consents: %w", err)
	}
	defer rows.Close()

	out := domainfinance.OFConsentList{UserID: userID, Consents: []domainfinance.OFConsent{}}
	for rows.Next() {
		var (
			c        domainfinance.OFConsent
			products []string
			updated  time.Time
		)
		if err := rows.Scan(&c.ID, &c.PolpConsentID, &c.InstitutionID, &c.InstitutionName,
			&c.Status, &c.ExecutionStatus, &products, &c.URLToAuthenticate, &updated); err != nil {
			return domainfinance.OFConsentList{}, fmt.Errorf("scan of consent: %w", err)
		}
		c.Products = products
		c.UpdatedAt = updated.UTC().Format(time.RFC3339)
		out.Consents = append(out.Consents, c)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) OFAccounts(ctx context.Context, userID string) (domainfinance.OFAccountList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, polp_account_id, polp_consent_id, name, type, currency,
		       COALESCE(balance_amount, 0)::numeric(14,2)::text, balance_updated_at
		FROM finance_of_accounts
		WHERE user_id = $1
		ORDER BY name ASC`, userID)
	if err != nil {
		return domainfinance.OFAccountList{}, fmt.Errorf("of accounts: %w", err)
	}
	defer rows.Close()

	out := domainfinance.OFAccountList{UserID: userID, Accounts: []domainfinance.OFAccount{}}
	for rows.Next() {
		var (
			a         domainfinance.OFAccount
			balanceAt *time.Time
		)
		if err := rows.Scan(&a.ID, &a.PolpAccountID, &a.PolpConsentID, &a.Name, &a.Type,
			&a.Currency, &a.BalanceAmount, &balanceAt); err != nil {
			return domainfinance.OFAccountList{}, fmt.Errorf("scan of account: %w", err)
		}
		if balanceAt != nil {
			a.BalanceUpdatedAt = balanceAt.UTC().Format(time.RFC3339)
		}
		out.Accounts = append(out.Accounts, a)
	}
	return out, rows.Err()
}

// Transactions is the extrato: as transações do usuário (mês opcional), mais
// recentes primeiro, com o nome do lugar e a origem quando houver.
func (r *FinanceReadRepository) Transactions(ctx context.Context, userID, month string, limit int) (domainfinance.TransactionList, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	query := `
		SELECT id::text, occurred_at, type, amount::text, currency, category, account_id,
		       source, counterparty, description, external_category, inactive
		FROM finance_transactions
		WHERE user_id = $1`
	args := []any{userID}
	if month != "" {
		query += ` AND to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM') = $2`
		args = append(args, month)
	}
	query += ` ORDER BY occurred_at DESC, created_at DESC LIMIT ` + strconv.Itoa(limit)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return domainfinance.TransactionList{}, fmt.Errorf("transactions: %w", err)
	}
	defer rows.Close()

	out := domainfinance.TransactionList{UserID: userID, Month: month, Transactions: []domainfinance.Transaction{}}
	for rows.Next() {
		var (
			t  domainfinance.Transaction
			at time.Time
		)
		if err := rows.Scan(&t.ID, &at, &t.Type, &t.Amount, &t.Currency, &t.Category, &t.AccountID,
			&t.Source, &t.Counterparty, &t.Description, &t.ExternalCategory, &t.Inactive); err != nil {
			return domainfinance.TransactionList{}, fmt.Errorf("scan transaction: %w", err)
		}
		t.OccurredAt = at.UTC().Format(time.RFC3339)
		out.Transactions = append(out.Transactions, t)
	}
	return out, rows.Err()
}

// Transaction is one transaction by id, do usuário — a base do detalhe profundo.
func (r *FinanceReadRepository) Transaction(ctx context.Context, userID, id string) (domainfinance.Transaction, error) {
	var (
		t  domainfinance.Transaction
		at time.Time
	)
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, occurred_at, type, amount::text, currency, category, account_id,
		       source, counterparty, description, external_category, inactive
		FROM finance_transactions
		WHERE user_id = $1 AND id = $2`, userID, id).Scan(
		&t.ID, &at, &t.Type, &t.Amount, &t.Currency, &t.Category, &t.AccountID,
		&t.Source, &t.Counterparty, &t.Description, &t.ExternalCategory, &t.Inactive)
	if err != nil {
		return domainfinance.Transaction{}, fmt.Errorf("transaction: %w", err)
	}
	t.OccurredAt = at.UTC().Format(time.RFC3339)
	return t, nil
}

// -------------------------------------------------------------- Notificações

func (r *FinanceReadRepository) Notifications(ctx context.Context, userID string) (domainfinance.NotificationList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, kind, category, COALESCE(threshold, 0)::numeric(14,2)::text, channel, enabled
		FROM finance_notifications
		WHERE user_id = $1
		ORDER BY created_at DESC`, userID)
	if err != nil {
		return domainfinance.NotificationList{}, fmt.Errorf("notifications: %w", err)
	}
	defer rows.Close()

	out := domainfinance.NotificationList{UserID: userID, Notifications: []domainfinance.Notification{}}
	for rows.Next() {
		var n domainfinance.Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Category, &n.Threshold, &n.Channel, &n.Enabled); err != nil {
			return domainfinance.NotificationList{}, fmt.Errorf("scan notification: %w", err)
		}
		out.Notifications = append(out.Notifications, n)
	}
	return out, rows.Err()
}

// Investments is the investimento projection: positions by gross desc.
func (r *FinanceReadRepository) Investments(ctx context.Context, userID string) (domainfinance.InvestmentList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, type, family, institution_name, currency,
		       invested_amount::text, gross_amount::text, net_amount::text,
		       income_tax::text, iof::text,
		       -- investido desconhecido (ações/fundos: coluna 0) NÃO vira
		       -- rendimento = bruto; fica vazio, e a UI mostra "—".
		       CASE WHEN invested_amount > 0
		            THEN (gross_amount - invested_amount)::numeric(18,2)::text
		            ELSE '' END AS yield_amount,
		       yield_percent, indexer, indexer_rate, yield_label,
		       quantity, due_date, isin_code, ticker, updated_at
		FROM finance_investments
		WHERE user_id = $1
		  -- posições zeradas (ativos 12/classes sem posição) não são posição:
		  -- o dado cru segue em finance_of_raw, mas a tela não mostra lixo.
		  AND (gross_amount <> 0 OR quantity ~ '[1-9]')
		ORDER BY gross_amount DESC`, userID)
	if err != nil {
		return domainfinance.InvestmentList{}, fmt.Errorf("investimens list: %w", err)
	}
	defer rows.Close()

	out := domainfinance.InvestmentList{UserID: userID}
	for rows.Next() {
		var i domainfinance.Investment
		var at time.Time
		if err := rows.Scan(&i.ID, &i.Name, &i.Type, &i.Family, &i.InstitutionName, &i.Currency,
			&i.InvestedAmount, &i.GrossAmount, &i.NetAmount, &i.IncomeTax, &i.IOF,
			&i.YieldAmount, &i.YieldPercent, &i.Indexer, &i.IndexerRate, &i.YieldLabel,
			&i.Quantity, &i.DueDate, &i.IsinCode, &i.Ticker, &at); err != nil {
			return domainfinance.InvestmentList{}, fmt.Errorf("scan investment: %w", err)
		}
		i.UpdatedAt = at.UTC().Format(time.RFC3339)
		out.Investments = append(out.Investments, i)
	}
	return out, rows.Err()
}

// ---------------------------------------------- Open Finance "pegar tudo"

func (r *FinanceReadRepository) CreditCards(ctx context.Context, userID string) (domainfinance.CreditCardList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, polp_consent_id, name, brand, last4,
		       credit_limit::text, available_limit::text, balance::text,
		       currency, due_day, updated_at
		FROM finance_credit_cards
		WHERE user_id = $1
		ORDER BY name ASC`, userID)
	if err != nil {
		return domainfinance.CreditCardList{}, fmt.Errorf("credit cards list: %w", err)
	}
	defer rows.Close()
	out := domainfinance.CreditCardList{UserID: userID, CreditCards: []domainfinance.CreditCard{}}
	for rows.Next() {
		var c domainfinance.CreditCard
		var at time.Time
		if err := rows.Scan(&c.ID, &c.ConsentID, &c.Name, &c.Brand, &c.Last4,
			&c.CreditLimit, &c.AvailableLimit, &c.Balance, &c.Currency, &c.DueDay, &at); err != nil {
			return domainfinance.CreditCardList{}, fmt.Errorf("scan credit card: %w", err)
		}
		c.UpdatedAt = at.UTC().Format(time.RFC3339)
		out.CreditCards = append(out.CreditCards, c)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) Bills(ctx context.Context, userID string) (domainfinance.BillList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, polp_card_id, due_date, close_date,
		       total_amount::text, minimum_amount::text, currency, status, updated_at
		FROM finance_bills
		WHERE user_id = $1
		ORDER BY due_date DESC`, userID)
	if err != nil {
		return domainfinance.BillList{}, fmt.Errorf("bills list: %w", err)
	}
	defer rows.Close()
	out := domainfinance.BillList{UserID: userID, Bills: []domainfinance.Bill{}}
	for rows.Next() {
		var b domainfinance.Bill
		var at time.Time
		if err := rows.Scan(&b.ID, &b.CardID, &b.DueDate, &b.CloseDate,
			&b.TotalAmount, &b.MinimumAmount, &b.Currency, &b.Status, &at); err != nil {
			return domainfinance.BillList{}, fmt.Errorf("scan bill: %w", err)
		}
		b.UpdatedAt = at.UTC().Format(time.RFC3339)
		out.Bills = append(out.Bills, b)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) Loans(ctx context.Context, userID string) (domainfinance.LoanList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, type, contract_amount::text, outstanding_balance::text,
		       installment_amount::text, interest_rate, currency, contract_date, due_date,
		       total_installments, paid_installments, updated_at
		FROM finance_loans
		WHERE user_id = $1
		ORDER BY outstanding_balance DESC`, userID)
	if err != nil {
		return domainfinance.LoanList{}, fmt.Errorf("loans list: %w", err)
	}
	defer rows.Close()
	out := domainfinance.LoanList{UserID: userID, Loans: []domainfinance.Loan{}}
	for rows.Next() {
		var l domainfinance.Loan
		var at time.Time
		if err := rows.Scan(&l.ID, &l.Name, &l.Type, &l.ContractAmount, &l.OutstandingBalance,
			&l.InstallmentAmount, &l.InterestRate, &l.Currency, &l.ContractDate, &l.DueDate,
			&l.TotalInstallments, &l.PaidInstallments, &at); err != nil {
			return domainfinance.LoanList{}, fmt.Errorf("scan loan: %w", err)
		}
		l.UpdatedAt = at.UTC().Format(time.RFC3339)
		out.Loans = append(out.Loans, l)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) Financings(ctx context.Context, userID string) (domainfinance.FinancingList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, type, contract_amount::text, outstanding_balance::text,
		       installment_amount::text, interest_rate, currency, contract_date, due_date,
		       total_installments, paid_installments, updated_at
		FROM finance_financings
		WHERE user_id = $1
		ORDER BY outstanding_balance DESC`, userID)
	if err != nil {
		return domainfinance.FinancingList{}, fmt.Errorf("financings list: %w", err)
	}
	defer rows.Close()
	out := domainfinance.FinancingList{UserID: userID, Financings: []domainfinance.Financing{}}
	for rows.Next() {
		var f domainfinance.Financing
		var at time.Time
		if err := rows.Scan(&f.ID, &f.Name, &f.Type, &f.ContractAmount, &f.OutstandingBalance,
			&f.InstallmentAmount, &f.InterestRate, &f.Currency, &f.ContractDate, &f.DueDate,
			&f.TotalInstallments, &f.PaidInstallments, &at); err != nil {
			return domainfinance.FinancingList{}, fmt.Errorf("scan financing: %w", err)
		}
		f.UpdatedAt = at.UTC().Format(time.RFC3339)
		out.Financings = append(out.Financings, f)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) Exchanges(ctx context.Context, userID string) (domainfinance.ExchangeList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, type, amount::text, currency, target_currency, exchange_rate,
		       occurred_at, updated_at
		FROM finance_exchanges
		WHERE user_id = $1
		ORDER BY occurred_at DESC NULLS LAST`, userID)
	if err != nil {
		return domainfinance.ExchangeList{}, fmt.Errorf("exchanges list: %w", err)
	}
	defer rows.Close()
	out := domainfinance.ExchangeList{UserID: userID, Exchanges: []domainfinance.Exchange{}}
	for rows.Next() {
		var e domainfinance.Exchange
		var occurred *time.Time
		var at time.Time
		if err := rows.Scan(&e.ID, &e.Type, &e.Amount, &e.Currency, &e.TargetCurrency,
			&e.ExchangeRate, &occurred, &at); err != nil {
			return domainfinance.ExchangeList{}, fmt.Errorf("scan exchange: %w", err)
		}
		if occurred != nil {
			e.OccurredAt = occurred.UTC().Format(time.RFC3339)
		}
		e.UpdatedAt = at.UTC().Format(time.RFC3339)
		out.Exchanges = append(out.Exchanges, e)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) InvestmentTransactions(ctx context.Context, userID string) (domainfinance.InvestmentTransactionList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, polp_invest_id, family, type, amount::text, currency,
		       occurred_at, updated_at
		FROM finance_investment_transactions
		WHERE user_id = $1
		ORDER BY occurred_at DESC NULLS LAST`, userID)
	if err != nil {
		return domainfinance.InvestmentTransactionList{}, fmt.Errorf("investment transactions list: %w", err)
	}
	defer rows.Close()
	out := domainfinance.InvestmentTransactionList{UserID: userID, InvestmentTransactions: []domainfinance.InvestmentTransaction{}}
	for rows.Next() {
		var t domainfinance.InvestmentTransaction
		var occurred *time.Time
		var at time.Time
		if err := rows.Scan(&t.ID, &t.InvestID, &t.Family, &t.Type, &t.Amount, &t.Currency,
			&occurred, &at); err != nil {
			return domainfinance.InvestmentTransactionList{}, fmt.Errorf("scan investment transaction: %w", err)
		}
		if occurred != nil {
			t.OccurredAt = occurred.UTC().Format(time.RFC3339)
		}
		t.UpdatedAt = at.UTC().Format(time.RFC3339)
		out.InvestmentTransactions = append(out.InvestmentTransactions, t)
	}
	return out, rows.Err()
}

func (r *FinanceReadRepository) OFRaw(ctx context.Context, userID string) (domainfinance.OFRawList, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, resource, external_id, payload::text, captured_at
		FROM finance_of_raw
		WHERE user_id = $1
		ORDER BY captured_at DESC`, userID)
	if err != nil {
		return domainfinance.OFRawList{}, fmt.Errorf("of raw list: %w", err)
	}
	defer rows.Close()
	out := domainfinance.OFRawList{UserID: userID, Records: []domainfinance.OFRawRecord{}}
	for rows.Next() {
		var rec domainfinance.OFRawRecord
		var at time.Time
		if err := rows.Scan(&rec.ID, &rec.Resource, &rec.ExternalID, &rec.Payload, &at); err != nil {
			return domainfinance.OFRawList{}, fmt.Errorf("scan of raw: %w", err)
		}
		rec.CapturedAt = at.UTC().Format(time.RFC3339)
		out.Records = append(out.Records, rec)
	}
	return out, rows.Err()
}
