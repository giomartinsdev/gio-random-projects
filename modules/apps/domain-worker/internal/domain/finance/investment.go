package finance

import (
	"errors"
	"time"
)

// Investment é uma posição de investimento importada do Open Finance
// (Celcoin/Polp via conector). Value-object Money segue §3.4: Decimal exatos,
// nunca float. Rendimento = bruto - investido (precomputado pelo conector,
// já que o provedor entrega os dois valores).
type Investment struct {
	ID             string
	UserID         string
	PolpConsentID  string
	PolpInvestID   string
	InstitutionName string
	Type           string // CDB | LCI | LCA | TESOURO_DIRETO | FUNDO | CRIPTO | OUTRO
	Name           string
	Currency       string
	InvestedAmount Money
	GrossAmount    Money
	YieldAmount    Money
	YieldPercent   string // decimal canônico, ex. "12.55"
	UpdatedAt      time.Time
	UpdatedAtStr   string // RFC3339 como veio do provedor
}

func (i Investment) YieldOnCostPercent() string { return i.YieldPercent }

var (
	ErrInvestExternalIDRequired = errors.New("polp_invest_id is required")
	ErrInvestInstitutionRequired = errors.New("institution_name is required")
)

// NewInvestition valida invariants minimal (posições sem money zerada são
// válidas: um ativo ainda sem renda).
func NewInvestment(id, userID, polpConsentID, polpInvestID, institution, itype, name string,
	invested, gross Money, yieldPct string, updatedAt time.Time) (Investment, error) {
	if polpInvestID == "" {
		return Investment{}, ErrInvestExternalIDRequired
	}
	if institution == "" {
		return Investment{}, ErrInvestInstitutionRequired
	}
	if userID == "" {
		return Investment{}, ErrUserIDRequired
	}
	currency := invested.Currency
	if currency == "" {
		currency = "BRL"
	}
	return Investment{
		ID: id, UserID: userID, PolpConsentID: polpConsentID, PolpInvestID: polpInvestID,
		InstitutionName: institution, Type: itype, Name: name,
		Currency: currency, InvestedAmount: invested, GrossAmount: gross,
		YieldAmount: Money{Cents: gross.Cents - invested.Cents, Currency: currency},
		YieldPercent: yieldPct, UpdatedAt: updatedAt,
	}, nil
}
