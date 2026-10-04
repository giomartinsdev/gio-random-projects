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
}

type CategorizeTransactionInput struct {
	TransactionID string `json:"transaction_id"`
	Category      string `json:"category"`
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
