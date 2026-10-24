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

import (
	"context"
	"errors"
)

// ErrNotFound é devolvido quando a transação não existe (ou não é do usuário).
var ErrNotFound = errors.New("transaction not found")

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

// Transaction is one ledger line as the extrato shows it: data, valor, tipo,
// categoria e — quando vier do banco — o nome do lugar (counterparty), a
// descrição crua e a origem.
type Transaction struct {
	ID               string `json:"id"`
	OccurredAt       string `json:"occurred_at"`
	Type             string `json:"transaction_type"`
	Amount           string `json:"amount"`
	Currency         string `json:"currency"`
	Category         string `json:"category"`
	AccountID        string `json:"account_id"`
	Source           string `json:"source"`
	Counterparty     string `json:"counterparty"`
	Description      string `json:"description"`
	ExternalCategory string `json:"external_category"`
	// Inactive marca movimentação entre contas PRÓPRIAS (ex.: BTG → MP): o
	// mesmo dinheiro entra e sai. Fora de receitas/despesas/net/categorias/
	// cashflow — MAS vale no saldo da conta (que soma tudo, senão descasa com
	// o extrato do banco). O dono alterna pela UI; o valor do lançamento é
	// mostrado esmaecido quando ativo=false.
	Inactive bool `json:"inactive"`
}

// TransactionList is the extrato: the user's transactions in a window, newest
// first. `Month` filters by calendar month (UTC); vazio = sem filtro de mês.
type TransactionList struct {
	UserID       string        `json:"user_id"`
	Month        string        `json:"month"`
	Transactions []Transaction `json:"transactions"`
}

// Notification is one alert rule the person registered.
type Notification struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Category  string `json:"category"`
	Threshold string `json:"threshold"`
	Channel   string `json:"channel"`
	Enabled   bool   `json:"enabled"`
}

// NotificationList is the alerts projection.
type NotificationList struct {
	UserID        string         `json:"user_id"`
	Notifications []Notification `json:"notifications"`
}

// OFConsent is one Open Finance connection as the SPA shows it.
type OFConsent struct {
	ID                string   `json:"id"`
	PolpConsentID     string   `json:"consent_id"`
	InstitutionID     string   `json:"institution_id"`
	InstitutionName   string   `json:"institution_name"`
	Status            string   `json:"status"`
	ExecutionStatus   string   `json:"execution_status"`
	Products          []string `json:"products"`
	URLToAuthenticate string   `json:"url_to_authenticate,omitempty"`
	UpdatedAt         string   `json:"updated_at"`
}

// OFConsentList is the §4.2 projection of the user's connections.
type OFConsentList struct {
	UserID   string      `json:"user_id"`
	Consents []OFConsent `json:"consents"`
}

// OFAccount is one imported bank account with its balance.
type OFAccount struct {
	ID               string `json:"id"`
	PolpAccountID    string `json:"account_id"`
	PolpConsentID    string `json:"consent_id"`
	Name             string `json:"name"`
	Type             string `json:"account_type"`
	Currency         string `json:"currency"`
	BalanceAmount    string `json:"balance_amount"`
	BalanceUpdatedAt string `json:"balance_updated_at,omitempty"`
}

// OFAccountList is the §4.2 projection of the user's connected accounts.
type OFAccountList struct {
	UserID   string      `json:"user_id"`
	Accounts []OFAccount `json:"accounts"`
}

// ReadRepository is domain-api's read-only port over the finance tables.
// Every method is a projection; none writes. A method per query in §4.2.
type ReadRepository interface {
	DailySummary(ctx context.Context, userID, date string) (DailySummary, error)
	MonthlyDashboard(ctx context.Context, userID, month string) (MonthlyDashboard, error)
	CategoryBreakdown(ctx context.Context, userID, month string) (CategoryBreakdown, error)
	CashFlowHistory(ctx context.Context, userID, month string) (CashFlowHistory, error)
	Transactions(ctx context.Context, userID, month string, limit int) (TransactionList, error)
	Transaction(ctx context.Context, userID, id string) (Transaction, error)
	Notifications(ctx context.Context, userID string) (NotificationList, error)
	OFConsents(ctx context.Context, userID string) (OFConsentList, error)
	OFAccounts(ctx context.Context, userID string) (OFAccountList, error)
	Investments(ctx context.Context, userID string) (InvestmentList, error)
	CreditCards(ctx context.Context, userID string) (CreditCardList, error)
	Bills(ctx context.Context, userID string) (BillList, error)
	Loans(ctx context.Context, userID string) (LoanList, error)
	Financings(ctx context.Context, userID string) (FinancingList, error)
	Exchanges(ctx context.Context, userID string) (ExchangeList, error)
	InvestmentTransactions(ctx context.Context, userID string) (InvestmentTransactionList, error)
	OFRaw(ctx context.Context, userID string) (OFRawList, error)
}

// Investment is one investment position imported from Open Finance.
type Investment struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Type            string `json:"type"`
	Family          string `json:"family,omitempty"`
	InstitutionName string `json:"institution_name"`
	Currency        string `json:"currency"`
	InvestedAmount  string `json:"invested_amount"`
	GrossAmount     string `json:"gross_amount"`
	NetAmount       string `json:"net_amount"`
	IncomeTax       string `json:"income_tax"`
	IOF             string `json:"iof"`
	YieldAmount     string `json:"yield_amount"`
	YieldPercent    string `json:"yield_percent"`
	Indexer         string `json:"indexer,omitempty"`
	IndexerRate     string `json:"indexer_rate,omitempty"`
	YieldLabel      string `json:"yield_label,omitempty"`
	Quantity        string `json:"quantity,omitempty"`
	DueDate         string `json:"due_date,omitempty"`
	IsinCode        string `json:"isin_code,omitempty"`
	Ticker          string `json:"ticker,omitempty"`
	UpdatedAt       string `json:"updated_at"`
}

// InvestmentList is the investments projection.
type InvestmentList struct {
	UserID       string        `json:"user_id"`
	Investments  []Investment  `json:"investments"`
}

// ------------------------------------------------- Open Finance "pegar tudo"

type CreditCard struct {
	ID             string `json:"id"`
	ConsentID      string `json:"consent_id"`
	Name           string `json:"name"`
	Brand          string `json:"brand"`
	Last4          string `json:"last4"`
	CreditLimit    string `json:"credit_limit"`
	AvailableLimit string `json:"available_limit"`
	Balance        string `json:"balance"`
	Currency       string `json:"currency"`
	DueDay         string `json:"due_day"`
	UpdatedAt      string `json:"updated_at"`
}
type CreditCardList struct {
	UserID      string       `json:"user_id"`
	CreditCards []CreditCard `json:"credit_cards"`
}

type Bill struct {
	ID            string `json:"id"`
	CardID        string `json:"card_id"`
	DueDate       string `json:"due_date"`
	CloseDate     string `json:"close_date"`
	TotalAmount   string `json:"total_amount"`
	MinimumAmount string `json:"minimum_amount"`
	Currency      string `json:"currency"`
	Status        string `json:"status"`
	UpdatedAt     string `json:"updated_at"`
}
type BillList struct {
	UserID string `json:"user_id"`
	Bills  []Bill `json:"bills"`
}

type Loan struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Type               string `json:"type"`
	ContractAmount     string `json:"contract_amount"`
	OutstandingBalance string `json:"outstanding_balance"`
	InstallmentAmount  string `json:"installment_amount"`
	InterestRate       string `json:"interest_rate"`
	Currency           string `json:"currency"`
	ContractDate       string `json:"contract_date"`
	DueDate            string `json:"due_date"`
	TotalInstallments  string `json:"total_installments"`
	PaidInstallments   string `json:"paid_installments"`
	UpdatedAt          string `json:"updated_at"`
}
type LoanList struct {
	UserID string `json:"user_id"`
	Loans  []Loan `json:"loans"`
}

type Financing struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Type               string `json:"type"`
	ContractAmount     string `json:"contract_amount"`
	OutstandingBalance string `json:"outstanding_balance"`
	InstallmentAmount  string `json:"installment_amount"`
	InterestRate       string `json:"interest_rate"`
	Currency           string `json:"currency"`
	ContractDate       string `json:"contract_date"`
	DueDate            string `json:"due_date"`
	TotalInstallments  string `json:"total_installments"`
	PaidInstallments   string `json:"paid_installments"`
	UpdatedAt          string `json:"updated_at"`
}
type FinancingList struct {
	UserID     string      `json:"user_id"`
	Financings []Financing `json:"financings"`
}

type Exchange struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Amount         string `json:"amount"`
	Currency       string `json:"currency"`
	TargetCurrency string `json:"target_currency"`
	ExchangeRate   string `json:"exchange_rate"`
	OccurredAt     string `json:"occurred_at,omitempty"`
	UpdatedAt      string `json:"updated_at"`
}
type ExchangeList struct {
	UserID    string     `json:"user_id"`
	Exchanges []Exchange `json:"exchanges"`
}

type InvestmentTransaction struct {
	ID         string `json:"id"`
	InvestID   string `json:"invest_id"`
	Family     string `json:"family"`
	Type       string `json:"type"`
	Amount     string `json:"amount"`
	Currency   string `json:"currency"`
	OccurredAt string `json:"occurred_at,omitempty"`
	UpdatedAt  string `json:"updated_at"`
}
type InvestmentTransactionList struct {
	UserID                 string                  `json:"user_id"`
	InvestmentTransactions []InvestmentTransaction `json:"investment_transactions"`
}

type OFRawRecord struct {
	ID         string `json:"id"`
	Resource   string `json:"resource"`
	ExternalID string `json:"external_id"`
	Payload    string `json:"payload"`
	CapturedAt string `json:"captured_at"`
}
type OFRawList struct {
	UserID  string        `json:"user_id"`
	Records []OFRawRecord `json:"records"`
}
