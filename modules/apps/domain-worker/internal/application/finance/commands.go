// Package finance holds the concrete application.Command payloads for the
// finance aggregates — finance-api's outbound client builds the same shapes on
// the other end (its own copy, used only to produce commands).
package finance

// RegisterTransactionInput is the finance.transaction.register payload. Todos
// os valores monetários chegam como STRING decimal (nunca número), a regra do
// §3.4 que a ACL já impõe antes de publicar.
type RegisterTransactionInput struct {
	UserID     string `json:"user_id"`
	AccountID  string `json:"account_id"`
	Type       string `json:"transaction_type"`
	Amount     string `json:"amount"`
	Currency   string `json:"currency"`
	Category   string `json:"category"`
	OccurredAt string `json:"occurred_at"`
	SourceType string `json:"source_type,omitempty"`
	// Open Finance (opcional): presentes quando a transação vem do import
	// bancário. ExternalID é obrigatório nesse caso (idempotência).
	ExternalID       string `json:"external_id,omitempty"`
	OFAccountID      string `json:"of_account_id,omitempty"`
	Counterparty     string `json:"counterparty,omitempty"`
	ExternalCategory string `json:"external_category,omitempty"`
	Description      string `json:"description,omitempty"`
	// Historical=true no backfill inicial do Open Finance: o worker
	// conversacional NÃO notifica (senão conectar espalha centenas de msgs).
	Historical bool `json:"historical,omitempty"`
}

type CategorizeTransactionInput struct {
	TransactionID string `json:"transaction_id"`
	Category      string `json:"category"`
}

// UpdateTransactionInput é o finance.transaction.update: correção de um
// lançamento já registrado, pela UI ou pelo WhatsApp. Campos vazios mantêm o
// valor atual (patch parcial); amount/currency vão juntos e quando amount
// vier, transaction_type vem junto — o sinal do amount é derivado do tipo.
type UpdateTransactionInput struct {
	UserID       string `json:"user_id"`
	TransactionID string `json:"transaction_id"`
	Category     string `json:"category,omitempty"`
	Counterparty string `json:"counterparty,omitempty"`
	Description  string `json:"description,omitempty"`
	Amount       string `json:"amount,omitempty"`
	Currency     string `json:"currency,omitempty"`
	TransactionType string `json:"transaction_type,omitempty"`
	OccurredAt   string `json:"occurred_at,omitempty"`
}

// RemoveTransactionInput é o finance.transaction.remove: apaga o lançamento do
// ledger. Posse obrigatória: o worker recusa remover linha de outro user.
type RemoveTransactionInput struct {
	UserID        string `json:"user_id"`
	TransactionID string `json:"transaction_id"`
}

// SetTransactionActiveInput é o finance.transaction.setActive: a flag de
// movimentação entre contas próprias. inactive=true tira o lançamento de
// receitas/despesas/net/categorias/cashflow (a perna financeira), mas o
// REGISTRO continua — e o saldo da conta (que soma tudo) fica exato.
type SetTransactionActiveInput struct {
	UserID        string `json:"user_id"`
	TransactionID string `json:"transaction_id"`
	Active        bool   `json:"active"`
}

type TransferBetweenAccountsInput struct {
	UserID        string `json:"user_id"`
	FromAccountID string `json:"from_account_id"`
	ToAccountID   string `json:"to_account_id"`
	Amount        string `json:"amount"`
	Currency      string `json:"currency"`
	OccurredAt    string `json:"occurred_at"`
}

type SetCategoryBudgetInput struct {
	UserID   string `json:"user_id"`
	Category string `json:"category"`
	Limit    string `json:"limit"`
	Currency string `json:"currency"`
	Period   string `json:"period"` // "YYYY-MM"; a finance-api emite `period`, não `month`
}

// Open Finance (Polp/Celcoin). A ACL cria o consentimento no provedor e publica
// o comando; o conector publica os de sync. Quem grava é sempre o domain-worker.
type ConsentCreatedInput struct {
	UserID            string   `json:"user_id"`
	PolpConsentID     string   `json:"polp_consent_id"`
	InstitutionID     string   `json:"institution_id"`
	InstitutionName   string   `json:"institution_name,omitempty"`
	Status            string   `json:"status"`
	ExecutionStatus   string   `json:"execution_status,omitempty"`
	Products          []string `json:"products,omitempty"`
	URLToAuthenticate string   `json:"url_to_authenticate,omitempty"`
	URLExpiresAt      string   `json:"url_expires_at,omitempty"`
}

type ConsentUpdatedInput struct {
	PolpConsentID   string `json:"polp_consent_id"`
	Status          string `json:"status"`
	ExecutionStatus string `json:"execution_status,omitempty"`
}

type AccountSyncedInput struct {
	UserID          string `json:"user_id"`
	PolpConsentID   string `json:"polp_consent_id"`
	PolpAccountID   string `json:"polp_account_id"`
	Name            string `json:"name,omitempty"`
	AccountType     string `json:"account_type,omitempty"`
	Currency        string `json:"currency,omitempty"`
	BalanceAmount   string `json:"balance_amount,omitempty"`
	BalanceUpdatedAt string `json:"balance_updated_at,omitempty"`
}

// NotificationInput é a regra de aviso (finance.notification.set).
type NotificationInput struct {
	UserID    string `json:"user_id"`
	ID        string `json:"notification_id,omitempty"`
	Kind      string `json:"kind"`
	Category  string `json:"category,omitempty"`
	Threshold string `json:"threshold,omitempty"`
	Channel   string `json:"channel,omitempty"`
	Enabled   *bool  `json:"enabled,omitempty"`
}

type NotificationDeleteInput struct {
	UserID         string `json:"user_id"`
	NotificationID string `json:"notification_id"`
}

// InvestmentSyncedInput é o finance.investment.synced (do conector). Valores
// monetários chegam como STRING decimal (§3.4) e o sinal é o natural: bruto
// >= investido em ativos com lucro.
type InvestmentSyncedInput struct {
	UserID       string `json:"user_id"`
	PolpConsentID string `json:"polp_consent_id"`
	PolpInvestID string `json:"polp_invest_id"`
	Family       string `json:"family,omitempty"`
	InstitutionName string `json:"institution_name"`
	Type         string `json:"type"`
	Name         string `json:"name"`
	Currency     string `json:"currency"`
	InvestedAmount  string `json:"invested_amount"`
	GrossAmount     string `json:"gross_amount"`
	NetAmount       string `json:"net_amount,omitempty"`
	IncomeTax       string `json:"income_tax,omitempty"`
	IOF             string `json:"iof,omitempty"`
	Quantity        string `json:"quantity,omitempty"`
	PurchaseUnit    string `json:"purchase_unit_price,omitempty"`
	Indexer         string `json:"indexer,omitempty"`
	IndexerRate     string `json:"indexer_rate,omitempty"`
	YieldLabel      string `json:"yield_label,omitempty"`
	DueDate         string `json:"due_date,omitempty"`
	IsinCode        string `json:"isin_code,omitempty"`
	Ticker          string `json:"ticker,omitempty"`
	UpdatedAt       string `json:"updated_at,omitempty"`
}

// Open Finance — "pegar tudo". Cada input espelha o payload do conector; todo
// dinheiro é STRING decimal (§3.4) e instante é RFC3339.

type CreditCardSyncedInput struct {
	UserID         string `json:"user_id"`
	PolpConsentID  string `json:"polp_consent_id"`
	PolpCardID     string `json:"polp_card_id"`
	Name           string `json:"name,omitempty"`
	Brand          string `json:"brand,omitempty"`
	Last4          string `json:"last4,omitempty"`
	CreditLimit    string `json:"credit_limit,omitempty"`
	AvailableLimit string `json:"available_limit,omitempty"`
	Balance        string `json:"balance,omitempty"`
	Currency       string `json:"currency,omitempty"`
	DueDay         string `json:"due_day,omitempty"`
	UpdatedAt      string `json:"updated_at,omitempty"`
}

type BillSyncedInput struct {
	UserID        string `json:"user_id"`
	PolpConsentID string `json:"polp_consent_id"`
	PolpBillID    string `json:"polp_bill_id"`
	PolpCardID    string `json:"polp_card_id"`
	DueDate       string `json:"due_date,omitempty"`
	CloseDate     string `json:"close_date,omitempty"`
	TotalAmount   string `json:"total_amount,omitempty"`
	MinimumAmount string `json:"minimum_amount,omitempty"`
	Currency      string `json:"currency,omitempty"`
	Status        string `json:"status,omitempty"`
	UpdatedAt     string `json:"updated_at,omitempty"`
}

type LoanSyncedInput struct {
	UserID            string `json:"user_id"`
	PolpConsentID     string `json:"polp_consent_id"`
	PolpLoanID        string `json:"polp_loan_id"`
	Name              string `json:"name,omitempty"`
	Type              string `json:"type,omitempty"`
	ContractAmount    string `json:"contract_amount,omitempty"`
	OutstandingBalance string `json:"outstanding_balance,omitempty"`
	InstallmentAmount string `json:"installment_amount,omitempty"`
	InterestRate      string `json:"interest_rate,omitempty"`
	Currency          string `json:"currency,omitempty"`
	ContractDate      string `json:"contract_date,omitempty"`
	DueDate           string `json:"due_date,omitempty"`
	TotalInstallments string `json:"total_installments,omitempty"`
	PaidInstallments  string `json:"paid_installments,omitempty"`
	UpdatedAt         string `json:"updated_at,omitempty"`
}

type FinancingSyncedInput struct {
	UserID            string `json:"user_id"`
	PolpConsentID     string `json:"polp_consent_id"`
	PolpFinancingID   string `json:"polp_financing_id"`
	Name              string `json:"name,omitempty"`
	Type              string `json:"type,omitempty"`
	ContractAmount    string `json:"contract_amount,omitempty"`
	OutstandingBalance string `json:"outstanding_balance,omitempty"`
	InstallmentAmount string `json:"installment_amount,omitempty"`
	InterestRate      string `json:"interest_rate,omitempty"`
	Currency          string `json:"currency,omitempty"`
	ContractDate      string `json:"contract_date,omitempty"`
	DueDate           string `json:"due_date,omitempty"`
	TotalInstallments string `json:"total_installments,omitempty"`
	PaidInstallments  string `json:"paid_installments,omitempty"`
	UpdatedAt         string `json:"updated_at,omitempty"`
}

type ExchangeSyncedInput struct {
	UserID         string `json:"user_id"`
	PolpConsentID  string `json:"polp_consent_id"`
	PolpExchangeID string `json:"polp_exchange_id"`
	Type           string `json:"type,omitempty"`
	Amount         string `json:"amount,omitempty"`
	Currency       string `json:"currency,omitempty"`
	TargetCurrency string `json:"target_currency,omitempty"`
	ExchangeRate   string `json:"exchange_rate,omitempty"`
	OccurredAt     string `json:"occurred_at,omitempty"`
	UpdatedAt      string `json:"updated_at,omitempty"`
}

type InvestmentTransactionSyncedInput struct {
	UserID        string `json:"user_id"`
	PolpConsentID string `json:"polp_consent_id"`
	PolpTxID      string `json:"polp_tx_id"`
	PolpInvestID  string `json:"polp_invest_id"`
	Family        string `json:"family,omitempty"`
	Type          string `json:"type,omitempty"`
	Amount        string `json:"amount,omitempty"`
	Currency      string `json:"currency,omitempty"`
	OccurredAt    string `json:"occurred_at,omitempty"`
	UpdatedAt     string `json:"updated_at,omitempty"`
}

type OFRawSyncedInput struct {
	UserID        string `json:"user_id"`
	PolpConsentID string `json:"polp_consent_id,omitempty"`
	Resource      string `json:"resource"`
	ExternalID    string `json:"external_id"`
	Payload       string `json:"payload"`
}
