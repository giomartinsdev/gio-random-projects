package finance

import "context"

// Repository é a porta de persistência do financeiro. domain-worker é o único
// implementador E o único chamador dos métodos de escrita.
type Repository interface {
	// Insert grava a transação. Idempotente por ID (o command_id vira o id):
	// reinserir o mesmo id é no-op. Devolve true quando inseriu de fato.
	Insert(ctx context.Context, t Transaction) (bool, error)
	FindByID(ctx context.Context, id string) (Transaction, error)
	UpdateCategory(ctx context.Context, id, category string) error
	// InsertTransfer grava o par débito+crédito numa única transação SQL
	// (§3.4 nº2: atômica). As duas linhas compartilham command_id.
	InsertTransfer(ctx context.Context, debit, credit Transaction) error
	// InsertBudget faz upsert do orçamento por (user_id, category, period) e
	// devolve o id ESTÁVEL da linha (o existente quando já havia, senão o novo).
	// É esse id que a régua usa como chave — usar o id recém-gerado faria cada
	// avaliação disparar de novo, porque a chave mudaria.
	UpsertBudget(ctx context.Context, b Budget) (string, error)
	// RecordThreshold grava o disparo de régua; devolve false quando já havia
	// disparo para a mesma (budget, threshold, period) — uma vez por limiar.
	RecordThreshold(ctx context.Context, b Budget, threshold int, period, spent, limit string) (bool, error)
	// SumSpent soma os gastos (EXPENSE) de uma categoria num período, em centavos.
	SumSpent(ctx context.Context, userID, category, period string) (int64, error)
	// UpsertConsent grava/atualiza um consentimento Open Finance por
	// polp_consent_id (idempotente — reprocessar não empilha).
	UpsertConsent(ctx context.Context, c Consent) error
	// UpdateConsentStatus muda o estado de um consentimento já existente.
	UpdateConsentStatus(ctx context.Context, polpConsentID string, status ConsentStatus, executionStatus string) error
	// UpsertOFAccount grava/atualiza uma conta importada por polp_account_id.
	UpsertOFAccount(ctx context.Context, a OFAccount) error
	// RemoveConsent apaga uma conexão (e as contas importadas dela) — é o que
	// revogar faz de fato: a linha some da lista, não fica como EXPIRED.
	RemoveConsent(ctx context.Context, polpConsentID string) error
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "transaction not found" }
