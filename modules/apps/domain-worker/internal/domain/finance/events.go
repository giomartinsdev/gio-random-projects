package finance

import "time"

// Event é implementado por todo evento de domínio deste agregado.
type Event interface {
	EventName() string
}

// TransactionRegistered carrega o estado corrente da transação.
type TransactionRegistered struct {
	TransactionID string          `json:"transaction_id"`
	UserID        string          `json:"user_id"`
	AccountID     string          `json:"account_id"`
	Type          TransactionType `json:"transaction_type"`
	Amount        string          `json:"amount"`   // decimal canônico (NUmero nunca float)
	Currency      string          `json:"currency"`
	Category      string          `json:"category"`
	OccurredAt    time.Time       `json:"occurred_at"`
	OccurredBy    time.Time       `json:"occurred_by,omitempty"`
}

func (TransactionRegistered) EventName() string { return "finance.transaction.registered" }

// TransactionCategorized diz que a categoria de uma transação mudou.
type TransactionCategorized struct {
	TransactionID string    `json:"transaction_id"`
	UserID        string    `json:"user_id"`
	Category      string    `json:"category"`
	OccurredAt    time.Time `json:"occurred_at"`
}

func (TransactionCategorized) EventName() string { return "finance.transaction.categorized" }

// TransferCompleted fecha a transferência atômica (§3.4 nº2).
type TransferCompleted struct {
	TransactionID string    `json:"transaction_id"`
	UserID        string    `json:"user_id"`
	FromAccountID string    `json:"from_account_id"`
	ToAccountID   string    `json:"to_account_id"`
	Amount        string    `json:"amount"`
	Currency      string    `json:"currency"`
	OccurredAt    time.Time `json:"occurred_at"`
}

func (TransferCompleted) EventName() string { return "finance.transfer.completed" }

// BudgetThresholdReached dispara UMA vez por (budget, threshold, período) —
// a chave de idempotência é o que faz "uma vez" ser verificável (§3.4 nº5).
type BudgetThresholdReached struct {
	BudgetID     string    `json:"budget_id"`
	UserID       string    `json:"user_id"`
	Category     string    `json:"category"`
	Threshold    int       `json:"threshold"`
	Period       string    `json:"period"`
	SpentAmount  string    `json:"spent_amount"`
	LimitAmount  string    `json:"limit_amount"`
	Currency     string    `json:"currency"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (BudgetThresholdReached) EventName() string { return "finance.budget.thresholdReached" }

// ConsentUpdated diz que o estado de uma conexão Open Finance mudou (autorizada,
// expirada, revogada). O worker conversacional usa para avisar "conta conectada".
type ConsentUpdated struct {
	PolpConsentID   string      `json:"polp_consent_id"`
	UserID          string      `json:"user_id"`
	InstitutionName string      `json:"institution_name"`
	Status          ConsentStatus `json:"status"`
	ExecutionStatus string      `json:"execution_status"`
	OccurredAt      time.Time   `json:"occurred_at"`
}

func (ConsentUpdated) EventName() string { return "finance.openfinance.consentUpdated" }
