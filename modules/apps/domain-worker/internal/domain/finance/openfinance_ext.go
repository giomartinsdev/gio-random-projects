package finance

import (
	"errors"
	"time"
)

// Entidades do Open Finance "pegar tudo" (docs/openfinance-spec.md). Cada uma
// espelha uma tabela finance_of_* normalizada; o id local é UUIDv7 gerado no
// serviço e a chave de idempotência é o id do provedor (polp_*).

var (
	ErrCardExternalIDRequired      = errors.New("polp_card_id is required")
	ErrBillExternalIDRequired      = errors.New("polp_bill_id is required")
	ErrLoanExternalIDRequired      = errors.New("polp_loan_id is required")
	ErrFinancingExternalIDRequired = errors.New("polp_financing_id is required")
	ErrExchangeExternalIDRequired  = errors.New("polp_exchange_id is required")
	ErrInvestTxExternalIDRequired  = errors.New("polp_tx_id is required")
	ErrRawResourceRequired         = errors.New("resource is required")
	ErrRawExternalIDRequired       = errors.New("external_id is required")
)

type CreditCard struct {
	ID             string
	UserID         string
	PolpConsentID  string
	PolpCardID     string
	Name           string
	Brand          string
	Last4          string
	CreditLimit    Money
	AvailableLimit Money
	Balance        Money
	Currency       string
	DueDay         string
	UpdatedAt      time.Time
}

type Bill struct {
	ID            string
	UserID        string
	PolpConsentID string
	PolpBillID    string
	PolpCardID    string
	DueDate       string
	CloseDate     string
	TotalAmount   Money
	MinimumAmount Money
	Currency      string
	Status        string
	UpdatedAt     time.Time
}

// CreditContract é compartilhado por empréstimo e financiamento (mesma forma).
type CreditContract struct {
	ID                 string
	UserID             string
	PolpConsentID      string
	ExternalID         string
	Name               string
	Type               string
	ContractAmount     Money
	OutstandingBalance Money
	InstallmentAmount  Money
	InterestRate       string
	Currency           string
	ContractDate       string
	DueDate            string
	TotalInstallments  string
	PaidInstallments   string
	UpdatedAt          time.Time
}

type Exchange struct {
	ID             string
	UserID         string
	PolpConsentID  string
	PolpExchangeID string
	Type           string
	Amount         Money
	Currency       string
	TargetCurrency string
	ExchangeRate   string
	OccurredAt     time.Time
	UpdatedAt      time.Time
}

type InvestmentTransaction struct {
	ID            string
	UserID        string
	PolpConsentID string
	PolpTxID      string
	PolpInvestID  string
	Family        string
	Type          string
	Amount        Money
	Currency      string
	OccurredAt    time.Time
	UpdatedAt     time.Time
}

// OFRaw é o JSON cru de um recurso do provedor — a garantia de completude.
type OFRaw struct {
	ID            string
	UserID        string
	PolpConsentID string
	Resource      string
	ExternalID    string
	Payload       string
	CapturedAt    time.Time
}
