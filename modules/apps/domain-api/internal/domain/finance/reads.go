// Package finance holds domain-api's READ models for the finance bounded
// context (docs/finance-system-spec.md §4.2).
//
// domain-api is read-only against the finance tables: the SQL lives in
// internal/infrastructure/postgres and projects the ledger into the shapes the
// finance-api relays to the WhatsApp worker and the SPA. domain-worker is the
// only writer (§1.1).
//
// Money crosses this boundary as a canonical decimal STRING, never a float
// (§3.4 nº1). The database stores NUMERIC(14,2), the query returns text, and
// these structs carry it verbatim — a float here is how a R$ 45,00 becomes
// R$ 44,999999 in a dashboard.
package finance

import "context"

// DailySummary is the §4.2 GetDailySummaryQuery result: one calendar day
// (UTC) of income/expense/net for a user.
type DailySummary struct {
	UserID           string `json:"user_id"`
	Date             string `json:"date"` // YYYY-MM-DD (UTC)
	Income           string `json:"income"`
	Expense          string `json:"expense"`
	Net              string `json:"net"`
	Currency         string `json:"currency"`
	TransactionCount int    `json:"transaction_count"`
}

// CategoryAmount is one category's expense total in a period.
type CategoryAmount struct {
	Category         string `json:"category"`
	Amount           string `json:"amount"`
	Currency         string `json:"currency"`
	TransactionCount int    `json:"transaction_count"`
}

// BudgetStatus is one budget's state in a month: the limit, what has been
// spent, and which régua thresholds (50/80/100) have already fired. The fired
// list is read from finance_budget_thresholds, so a consumer can tell "this
// alert already went out" from "it should go out now".
type BudgetStatus struct {
	Category     string `json:"category"`
	LimitAmount  string `json:"limit_amount"`
	SpentAmount  string `json:"spent_amount"`
	Currency     string `json:"currency"`
	Thresholds   []int  `json:"thresholds_reached"`
}

// MonthlyDashboard is the §4.2 GetMonthlyDashboardQuery result: the month's
// totals, the top expense categories, and the active budgets with their
// thresholds. It is what the WhatsApp "como estão meus gastos este mês?"
// answer renders from.
type MonthlyDashboard struct {
	UserID           string           `json:"user_id"`
	Month            string           `json:"month"` // YYYY-MM
	Income           string           `json:"income"`
	Expense          string           `json:"expense"`
	Net              string           `json:"net"`
	Currency         string           `json:"currency"`
	TransactionCount int              `json:"transaction_count"`
	TopCategories    []CategoryAmount `json:"top_categories"`
	Budgets          []BudgetStatus   `json:"budgets"`
}

// CategoryBreakdown is the §4.2 GetCategoryBreakdownQuery result: every
// expense category in the month, largest first (no top-N cap — the chat's
// "extrato" wants the full list).
type CategoryBreakdown struct {
	UserID     string           `json:"user_id"`
	Month      string           `json:"month"`
	Currency   string           `json:"currency"`
	Categories []CategoryAmount `json:"categories"`
}

// CashFlowDay is one day's bucket in the month's history.
type CashFlowDay struct {
	Date    string `json:"date"` // YYYY-MM-DD
	Income  string `json:"income"`
	Expense string `json:"expense"`
	Net     string `json:"net"`
}

// CashFlowHistory is the §4.2 GetCashFlowHistoryQuery result: the month broken
// into per-day buckets, in chronological order, for the chart engine.
type CashFlowHistory struct {
	UserID   string        `json:"user_id"`
	Month    string        `json:"month"`
	Currency string        `json:"currency"`
	Days     []CashFlowDay `json:"days"`
}

// ReadRepository is domain-api's read-only port over the finance tables.
// Every method is a projection; none writes. A method per query in §4.2.
type ReadRepository interface {
	DailySummary(ctx context.Context, userID, date string) (DailySummary, error)
	MonthlyDashboard(ctx context.Context, userID, month string) (MonthlyDashboard, error)
	CategoryBreakdown(ctx context.Context, userID, month string) (CategoryBreakdown, error)
	CashFlowHistory(ctx context.Context, userID, month string) (CashFlowHistory, error)
}
