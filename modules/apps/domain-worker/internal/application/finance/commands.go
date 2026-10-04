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
