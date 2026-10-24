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
	ID              string
	UserID          string
	PolpConsentID   string
	PolpInvestID    string
	Family          string // bank-fixed-incomes | credit-fixed-incomes | funds | treasure-titles | variable-incomes
	InstitutionName string
	Type            string // CDB | LCI | LCA | TESOURO_DIRETO | FUNDO | ACAO | DEBENTURE | OUTRO
	Name            string
	Currency        string
	InvestedAmount  Money // vazio Cents=0 = desconhecido (ações/fundos) — UI mostra "—"
	GrossAmount     Money
	NetAmount       Money // líquido após IR/IOF (é o que cai na conta do usuário)
	IncomeTax       Money
	IOF             Money
	Quantity        string
	PurchaseUnit    Money
	Indexer         string // CDI | SELIC | IPCA | PRE_FIXADO…
	IndexerRate     string // decimal canônico ("0.98" = 98% do indexador)
	YieldLabel      string // a string pronta do conector: "98% CDI"
	YieldPercent    string // % no custo (derivado)
	DueDate         string
	IsinCode        string
	Ticker          string
	UpdatedAt       time.Time
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
		YieldPercent: yieldPct, UpdatedAt: updatedAt,
	}, nil
}
