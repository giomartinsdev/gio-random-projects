// Package application is domain-api's use-case layer: just the Command
// envelope and the port to publish it. domain-worker has its own,
// larger copy of this package (Service, CommandHandler, extra ports)
// since it's the side that actually applies commands — see that
// module's application/command.go for the fuller picture of the event
// flow both sides agree on.
package application

import "encoding/json"

type Action string

const (
	// Financeiro (docs/finance-system-spec.md §4.1): a família finance.* que a
	// finance-api relaya. O domain-api só a publica; quem aplica é o
	// domain-worker.
	ActionRegisterTransaction   Action = "finance.transaction.register"
	ActionCategorizeTransaction Action = "finance.transaction.categorize"
	// Correção pelo próprio usuário (SPA): editar/remover um lançamento já
	// registrado. O domain-api só publica; quem aplica (e valida posse, §3.4
	// nº3) é o domain-worker.
	ActionUpdateTransaction    Action = "finance.transaction.update"
	ActionRemoveTransaction    Action = "finance.transaction.remove"
	ActionSetTransactionActive Action = "finance.transaction.setActive"
	// Flag de movimentação entre contas próprias (BTG → MP): inativo sai de
	// receitas/despesas/net/categorias/cashflow, mas fica no saldo da conta.
	ActionTransferBetweenAccounts Action = "finance.transfer.betweenAccounts"
	ActionSetCategoryBudget       Action = "finance.budget.setCategory"
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
