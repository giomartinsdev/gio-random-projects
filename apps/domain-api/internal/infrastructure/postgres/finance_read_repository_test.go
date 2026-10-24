package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Leitura do financeiro (§4.2) contra Postgres REAL, pelo mesmo harness do
// domain-api (schema do domain-worker, fonte única). O que só o banco prova:
// filtro por usuário/mês, sinal de EXPENSE, ordem do breakdown e as réguas
// já disparadas lidas de finance_budget_thresholds.

func seedFinanceTx(t *testing.T, pool *pgxpool.Pool, user, acct, typ, amount, category string, when time.Time) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO finance_transactions
			(id, user_id, account_id, type, amount, currency, category, source, occurred_at)
		VALUES ($1,$2,$3,$4,$5::numeric,'BRL',$6,'WHATSAPP_MANUAL',$7)`,
		uuid.NewString(), user, acct, typ, amount, category, when)
	if err != nil {
		t.Fatalf("seed finance tx: %v", err)
	}
}

func cleanupFinance(t *testing.T, pool *pgxpool.Pool, user string) {
	t.Helper()
	ctx := context.Background()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM finance_budget_thresholds WHERE budget_id IN (SELECT id FROM finance_budgets WHERE user_id = $1)`, user)
		_, _ = pool.Exec(ctx, `DELETE FROM finance_budgets WHERE user_id = $1`, user)
		_, _ = pool.Exec(ctx, `DELETE FROM finance_transactions WHERE user_id = $1`, user)
	})
}

func TestFinanceReadDailySummarySumsOneUTCDay(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewFinanceReadRepository(pool)
	user := "read-daily"
	cleanupFinance(t, pool, user)

	day := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	seedFinanceTx(t, pool, user, "a", "INCOME", "100.00", "Salário", day)
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-30.00", "Alimentação", day)
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-20.00", "Transporte", day)
	// Outro dia e outro usuário NÃO entram na soma.
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-999.00", "Alimentação", time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC))
	otherUser := user + "-other"
	cleanupFinance(t, pool, otherUser)
	seedFinanceTx(t, pool, otherUser, "a", "INCOME", "555.00", "Salário", day)

	got, err := repo.DailySummary(ctx, user, "2026-10-04")
	if err != nil {
		t.Fatalf("daily summary: %v", err)
	}
	if got.Income != "100.00" || got.Expense != "-50.00" || got.Net != "50.00" {
		t.Fatalf("income/expense/net = %s/%s/%s; want 100.00/-50.00/50.00", got.Income, got.Expense, got.Net)
	}
	if got.TransactionCount != 3 {
		t.Fatalf("count = %d; want 3", got.TransactionCount)
	}
}

func TestFinanceReadDailySummaryEmptyIsZero(t *testing.T) {
	pool := readPool(t)
	repo := NewFinanceReadRepository(pool)
	got, err := repo.DailySummary(context.Background(), "read-nobody", "2026-10-04")
	if err != nil {
		t.Fatalf("daily summary: %v", err)
	}
	if got.Income != "0.00" || got.Expense != "0.00" || got.Net != "0.00" || got.TransactionCount != 0 {
		t.Fatalf("dia sem dados = %+v; want zeros", got)
	}
}

func TestFinanceReadCategoryBreakdownOrdersLargestExpenseFirst(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewFinanceReadRepository(pool)
	user := "read-breakdown"
	cleanupFinance(t, pool, user)

	when := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-10.00", "Transporte", when)
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-90.00", "Alimentação", when)
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-5.00", "Alimentação", when)
	// INCOME não entra no breakdown de despesas.
	seedFinanceTx(t, pool, user, "a", "INCOME", "500.00", "Salário", when)

	got, err := repo.CategoryBreakdown(ctx, user, "2026-10")
	if err != nil {
		t.Fatalf("breakdown: %v", err)
	}
	if len(got.Categories) != 2 {
		t.Fatalf("categorias = %d; want 2 (%+v)", len(got.Categories), got.Categories)
	}
	// Alimentação soma -95,00 (em módulo 95 > 10); vem primeiro.
	if got.Categories[0].Category != "Alimentação" || got.Categories[0].Amount != "-95.00" {
		t.Fatalf("maior categoria = %+v; want Alimentação -95.00", got.Categories[0])
	}
	if got.Categories[1].Category != "Transporte" || got.Categories[1].Amount != "-10.00" {
		t.Fatalf("segunda categoria = %+v; want Transporte -10.00", got.Categories[1])
	}
}

func TestFinanceReadCashFlowHistoryIsChronologicalPerDay(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewFinanceReadRepository(pool)
	user := "read-cashflow"
	cleanupFinance(t, pool, user)

	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-30.00", "Alimentação", time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC))
	seedFinanceTx(t, pool, user, "a", "INCOME", "100.00", "Salário", time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC))
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-10.00", "Transporte", time.Date(2026, 10, 2, 15, 0, 0, 0, time.UTC))

	got, err := repo.CashFlowHistory(ctx, user, "2026-10")
	if err != nil {
		t.Fatalf("cashflow: %v", err)
	}
	if len(got.Days) != 2 {
		t.Fatalf("dias = %d; want 2 (%+v)", len(got.Days), got.Days)
	}
	if got.Days[0].Date != "2026-10-02" || got.Days[0].Income != "100.00" || got.Days[0].Expense != "-10.00" || got.Days[0].Net != "90.00" {
		t.Fatalf("dia 02 = %+v; want 2026-10-02 100.00/-10.00/90.00", got.Days[0])
	}
	if got.Days[1].Date != "2026-10-04" || got.Days[1].Net != "-30.00" {
		t.Fatalf("dia 04 = %+v; want 2026-10-04 net -30.00", got.Days[1])
	}
}

func TestFinanceReadMonthlyDashboardCarriesBudgetsAndFiredThresholds(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewFinanceReadRepository(pool)
	user := "read-dashboard"
	cleanupFinance(t, pool, user)

	when := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	seedFinanceTx(t, pool, user, "a", "INCOME", "1000.00", "Salário", when)
	seedFinanceTx(t, pool, user, "a", "EXPENSE", "-80.00", "Alimentação", when)

	// Orçamento de 100,00 em Alimentação, com o limiar 50 já gravado.
	var budgetID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO finance_budgets (id, user_id, category, limit_amount, currency, period)
		VALUES ($1,$2,'Alimentação','100.00','BRL','2026-10') RETURNING id`,
		uuid.NewString(), user).Scan(&budgetID); err != nil {
		t.Fatalf("seed budget: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO finance_budget_thresholds (budget_id, threshold, period, spent_amount, limit_amount, currency)
		VALUES ($1,50,'2026-10','80.00','100.00','BRL')`, budgetID); err != nil {
		t.Fatalf("seed threshold: %v", err)
	}

	got, err := repo.MonthlyDashboard(ctx, user, "2026-10")
	if err != nil {
		t.Fatalf("dashboard: %v", err)
	}
	if got.Income != "1000.00" || got.Expense != "-80.00" || got.Net != "920.00" {
		t.Fatalf("totais = %s/%s/%s; want 1000.00/-80.00/920.00", got.Income, got.Expense, got.Net)
	}
	if len(got.TopCategories) != 1 || got.TopCategories[0].Category != "Alimentação" {
		t.Fatalf("top categories = %+v; want [Alimentação]", got.TopCategories)
	}
	if len(got.Budgets) != 1 {
		t.Fatalf("budgets = %+v; want 1", got.Budgets)
	}
	b := got.Budgets[0]
	if b.Category != "Alimentação" || b.LimitAmount != "100.00" || b.SpentAmount != "-80.00" {
		t.Fatalf("budget = %+v; want Alimentação 100.00/-80.00", b)
	}
	if len(b.Thresholds) != 1 || b.Thresholds[0] != 50 {
		t.Fatalf("thresholds = %v; want [50]", b.Thresholds)
	}
}
