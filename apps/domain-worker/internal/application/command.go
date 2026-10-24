// Package application is domain-worker's use-case layer: the Command
// envelope, ports (what infrastructure must provide), and one
// subpackage per aggregate wiring the two together. domain-api has its
// own, smaller copy of this package (just Command + CommandPublisher)
// since it only ever produces commands, never applies them.
//
// Só o contexto financeiro declara ações aqui: os agregados de clubs e
// prospecta saíram com os apps que os publicavam.
package application

import "encoding/json"

type Action string

const (
	// Financeiro (docs/finance-system-spec.md §4.1): a família finance.* do
	// bounded context financeiro. A finance-api traduz o comando do worker
	// conversacional e repassa; o domain-worker aplica e grava a auditoria.
	ActionRegisterTransaction   Action = "finance.transaction.register"
	ActionCategorizeTransaction Action = "finance.transaction.categorize"
	// Correção pelo próprio usuário (SPA): editar/remover um lançamento já
	// registrado. O worker valida a posse (user_id) antes de aplicar.
	ActionUpdateTransaction Action = "finance.transaction.update"
	ActionRemoveTransaction Action = "finance.transaction.remove"
	// Flag de movimentação entre contas PRÓPRIAS (ex.: BTG → MP): o mesmo
	// dinheiro entra e sai do ledger. Marcar inativo tira o lançamento de
	// receitas/despesas/net/categorias/cashflow (senão dobra o mesmo gasto),
	// MAS ele continua valendo no saldo da conta — senão dessasenta com o
	// extrato do banco. É o usuário que ativa/desativa pela UI.
	ActionSetTransactionActive Action = "finance.transaction.setActive"
	// Open Finance — investimentos (posições e rendimentos do Celcoin/Polp).
	ActionInvestmentSynced        Action = "finance.investment.synced"
	ActionTransferBetweenAccounts Action = "finance.transfer.betweenAccounts"
	ActionSetCategoryBudget       Action = "finance.budget.setCategory"
	// Open Finance (docs/openfinance-spec.md): o ciclo do consentimento e o
	// sync de conta. Publicados pela ACL / pelo conector.
	ActionOFConsentCreated Action = "finance.openfinance.consentCreated"
	ActionOFConsentUpdated Action = "finance.openfinance.consentUpdated"
	ActionOFConsentRemoved Action = "finance.openfinance.consentRemoved"
	ActionOFAccountSynced  Action = "finance.openfinance.accountSynced"
	// Open Finance — "pegar tudo": cartões, faturas, empréstimos,
	// financiamentos, câmbio, movimentações de investimento e a captura RAW.
	ActionInvestmentTransactionSynced Action = "finance.investment.transactionSynced"
	ActionOFCreditCardSynced          Action = "finance.openfinance.creditCardSynced"
	ActionOFBillSynced                Action = "finance.openfinance.billSynced"
	ActionOFLoanSynced                Action = "finance.openfinance.loanSynced"
	ActionOFFinancingSynced           Action = "finance.openfinance.financingSynced"
	ActionOFExchangeSynced            Action = "finance.openfinance.exchangeSynced"
	ActionOFRawSynced                 Action = "finance.openfinance.rawSynced"
	// Notificações (regras que a pessoa cadastra).
	ActionNotifSet    Action = "finance.notification.set"
	ActionNotifDelete Action = "finance.notification.delete"
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
