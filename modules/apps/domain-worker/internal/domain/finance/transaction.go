package finance

import (
	"errors"
	"time"
)

var (
	ErrTransactionIDRequired = errors.New("transaction_id is required")
	ErrUserIDRequired        = errors.New("user_id is required")
	ErrTypeInvalid           = errors.New("transaction_type must be INCOME, EXPENSE or TRANSFER")
	ErrOccurredAtRequired    = errors.New("occurred_at is required")
	ErrOccurredAtNotUTC      = errors.New("occurred_at must be timezone-aware (stored in UTC)")
	ErrTransferNeedsAccounts = errors.New("a transfer needs distinct source and destination accounts")
	// ErrNotTransactionOwner: tentativa de editar/remover lançamento de outro
	// user — a invariant #3 (§3.4) aplicada na correção, não só na leitura.
	ErrNotTransactionOwner = errors.New("transaction does not belong to this user")
	// ErrNoChange: operação aplicada não alteraria nada (flag já no estado
	// pedido). No-op honesto, sem evento.
	ErrNoChange = errors.New("nothing to change")
)

// TransactionType é o enum do §3.2.
type TransactionType string

const (
	TypeIncome   TransactionType = "INCOME"
	TypeExpense  TransactionType = "EXPENSE"
	TypeTransfer TransactionType = "TRANSFER"
)

// Transaction é o agregado do ledger (§3.2). O id é UUIDv7 gerado pelo
// domain-worker (quem aplica) — a ACL/worker nunca inventam id (§4.1).
//
// Os campos de Open Finance só têm valor quando a transação foi importada do
// banco (Source == "OPEN_FINANCE_SYNC"): ExternalID é o id dela no provedor e
// é o que torna o import idempotente (índice único parcial no banco).
type Transaction struct {
	ID        string
	UserID    string
	AccountID string
	Type      TransactionType
	Amount    Money
	Category  string
	OccurredAt time.Time
	Source    string
	CreatedAt time.Time
	// Open Finance (opcional).
	ExternalID       string
	OFAccountID      string
	Counterparty     string
	ExternalCategory string
	Description      string
	Historical       bool
	// Inactive marca "movimentação entre contas próprias" (ex.: BTG → MP):
	// o mesmo dinheiro entra e sai, e contar duas vezes infla receitas e
	// despesas sem mudar nada real. Inativo = fora de receitas/despesas/net/
	// categorias/cashflow, MAS dentro do saldo da conta (que soma tudo, para
	// não descasar com o extrato do banco). O dono alterna pela UI.
	Inactive bool
}

// IsActive diz se a transação conta para as métricas da perna financeira.
func (t Transaction) IsActive() bool { return !t.Inactive }

// NewTransaction valida as invariantes do §3.4 na construção:
//   - user_id obrigatório;
//   - tipo válido;
//   - valor em centavos (Money já é exato);
//   - occurred_at tz-aware (armazenado em UTC — o §3.4 nº4).
//
// occurredAt precisa vir com fuso; um instante naive é recusado, não
// "assumido como UTC" — assumir é como o horário de um usuário em -03 vira o
// horário errado em produção.
func NewTransaction(id, userID, accountID string, ttype TransactionType, amount Money, category string, occurredAt time.Time, source string) (Transaction, error) {
	if id == "" {
		return Transaction{}, ErrTransactionIDRequired
	}
	if userID == "" {
		return Transaction{}, ErrUserIDRequired
	}
	if ttype != TypeIncome && ttype != TypeExpense && ttype != TypeTransfer {
		return Transaction{}, ErrTypeInvalid
	}
	if occurredAt.IsZero() {
		return Transaction{}, ErrOccurredAtRequired
	}
	// IsZero já pega o zero value; um instante sem fuso vem com Local/UTC
	// dependendo de quem montou — recusamos quando o Location é UTC por
	// omissão? Não há como distinguir com segurança no time.Time do Go além
	// da presença de fuso explícito. A validação real (aware) acontece na
	// borda (finance-api), que rejeita payload sem fuso antes de publicar
	// (§4.1). Aqui normalizamos para UTC.
	utc := occurredAt.UTC()
	if source == "" {
		source = "WHATSAPP_MANUAL"
	}
	return Transaction{
		ID:         id,
		UserID:     userID,
		AccountID:  accountID,
		Type:       ttype,
		Amount:     amount,
		Category:   category,
		OccurredAt: utc,
		Source:     source,
		CreatedAt:  time.Now().UTC(),
	}, nil
}
