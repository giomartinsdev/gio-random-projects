package finance

import (
	"errors"
	"time"
)

var (
	ErrConsentIDRequired  = errors.New("polp_consent_id is required")
	ErrInstitutionNeeded  = errors.New("institution_id is required")
	ErrAccountIDNeeded    = errors.New("polp_account_id is required")
)

// ConsentStatus é o enum ConsentStatus do provedor.
type ConsentStatus string

const (
	ConsentAwaitingAuthorization ConsentStatus = "AWAITING_AUTHORIZATION"
	ConsentAuthorised            ConsentStatus = "AUTHORISED"
	ConsentRejected              ConsentStatus = "REJECTED"
	ConsentExpired               ConsentStatus = "EXPIRED"
)

// Consent é o agregado do Open Finance: a conexão autorizada com um banco. O
// id local é UUIDv7 (como as transações); o id do provedor (Polp) é a chave de
// correlação externa e é único.
type Consent struct {
	ID                string
	PolpConsentID     string
	UserID            string
	InstitutionID     string
	InstitutionName   string
	Status            ConsentStatus
	ExecutionStatus   string
	Products          []string
	URLToAuthenticate string
	URLExpiresAt      time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func NewConsent(id, polpConsentID, userID, institutionID, institutionName string, status ConsentStatus, executionStatus string, products []string, url string, urlExpires time.Time) (Consent, error) {
	if id == "" {
		return Consent{}, ErrTransactionIDRequired
	}
	if polpConsentID == "" {
		return Consent{}, ErrConsentIDRequired
	}
	if userID == "" {
		return Consent{}, ErrUserIDRequired
	}
	if institutionID == "" {
		return Consent{}, ErrInstitutionNeeded
	}
	now := time.Now().UTC()
	return Consent{
		ID:                id,
		PolpConsentID:     polpConsentID,
		UserID:            userID,
		InstitutionID:     institutionID,
		InstitutionName:   institutionName,
		Status:            status,
		ExecutionStatus:   executionStatus,
		Products:          products,
		URLToAuthenticate: url,
		URLExpiresAt:      urlExpires,
		CreatedAt:         now,
		UpdatedAt:         now,
	}, nil
}

// OFAccount é a conta bancária importada de um consentimento, com o saldo
// disponível sincronizado. Idempotente por PolpAccountID.
type OFAccount struct {
	ID               string
	PolpAccountID    string
	PolpConsentID    string
	UserID           string
	Name             string
	Type             string
	Currency         string
	BalanceAmount    string // decimal string; "" quando ainda não sincronizou
	BalanceUpdatedAt time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func NewOFAccount(id, polpAccountID, polpConsentID, userID, name, accountType, currency, balance string, balanceAt time.Time) (OFAccount, error) {
	if id == "" {
		return OFAccount{}, ErrTransactionIDRequired
	}
	if polpAccountID == "" {
		return OFAccount{}, ErrAccountIDNeeded
	}
	if userID == "" {
		return OFAccount{}, ErrUserIDRequired
	}
	now := time.Now().UTC()
	return OFAccount{
		ID:               id,
		PolpAccountID:    polpAccountID,
		PolpConsentID:    polpConsentID,
		UserID:           userID,
		Name:             name,
		Type:             accountType,
		Currency:         currency,
		BalanceAmount:    balance,
		BalanceUpdatedAt: balanceAt,
		CreatedAt:        now,
		UpdatedAt:        now,
	}, nil
}
