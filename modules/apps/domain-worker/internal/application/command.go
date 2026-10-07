// Package application is domain-worker's use-case layer: the Command
// envelope, ports (what infrastructure must provide), and one
// subpackage per aggregate wiring the two together. domain-api has its
// own, smaller copy of this package (just Command + CommandPublisher)
// since it only ever produces commands, never applies them.
package application

import "encoding/json"

type Action string

const (
	// FC Clubs Hub (specs/003): public Pro Clubs data accumulated from the
	// EA source. The ingest worker is the only producer of club/partida/
	// snapshot/anuncio writes; clubs-api produces the per-person ones
	// (watchlist, claimed pro, notifications preferences).
	ActionUpsertClub        Action = "club.upsert"
	ActionUpsertClubeTotais Action = "clubetotais.upsert"
	ActionUpsertPartida     Action = "partida.upsert"
	ActionAppendSnapshot    Action = "clubesnapshot.append"
	ActionCreateAnuncio     Action = "anuncio.create"
	ActionSaveCareer        Action = "clubs.careerSave"
	// Saúde do worker de ingestão (clubs-ingest não serve HTTP).
	ActionSaveIngestEstado Action = "clubs.ingestEstado"

	// The per-person partition (usuario_email from the Access JWT) —
	// these are the only clubs actions that are not public data.
	ActionSetWatch    Action = "preferencia.setWatch"
	ActionRemoveWatch Action = "preferencia.removeWatch"
	ActionSaveNotify  Action = "preferencia.saveNotificacoes"
	ActionClaimPro    Action = "preferencia.claimPro"
	ActionSaveSyncRun Action = "preferencia.saveSyncRun"

	// Fila de fetch sob demanda de um clube (clubs_fetch_runs). A tela de
	// resgate grava o pedido, o worker Python polla e busca o elenco, e o
	// estado é gravado de volta por aqui.
	ActionRequestFetchRun Action = "clubs.fetchRun"
	ActionSaveFetchRun    Action = "clubs.fetchRunSave"

	// Busca ao vivo na fonte (clubs_search_runs), para um clube que o hub
	// ainda não viu.
	ActionRequestSearchRun Action = "clubs.searchRun"
	ActionSaveSearchRun    Action = "clubs.searchRunSave"

	// Financeiro (docs/finance-system-spec.md §4.1): a família finance.* do
	// bounded context financeiro. A finance-api traduz o comando do worker
	// conversacional e repassa; o domain-worker aplica e grava a auditoria.
	ActionRegisterTransaction    Action = "finance.transaction.register"
	ActionCategorizeTransaction  Action = "finance.transaction.categorize"
	// Correção pelo próprio usuário (SPA): editar/remover um lançamento já
	// registrado. O worker valida a posse (user_id) antes de aplicar.
	ActionUpdateTransaction      Action = "finance.transaction.update"
	ActionRemoveTransaction      Action = "finance.transaction.remove"
	// Flag de movimentação entre contas PRÓPRIAS (ex.: BTG → MP): o mesmo
	// dinheiro entra e sai do ledger. Marcar inativo tira o lançamento de
	// receitas/despesas/net/categorias/cashflow (senão dobra o mesmo gasto),
	// MAS ele continua valendo no saldo da conta — senão dessasenta com o
	// extrato do banco. É o usuário que ativa/desativa pela UI.
	ActionSetTransactionActive   Action = "finance.transaction.setActive"
	// Open Finance — investimentos (posições e rendimentos do Celcoin/Polp).
	ActionInvestmentSynced       Action = "finance.investment.synced"
	ActionTransferBetweenAccounts Action = "finance.transfer.betweenAccounts"
	ActionSetCategoryBudget      Action = "finance.budget.setCategory"
	// Open Finance (docs/openfinance-spec.md): o ciclo do consentimento e o
	// sync de conta. Publicados pela ACL / pelo conector.
	ActionOFConsentCreated Action = "finance.openfinance.consentCreated"
	ActionOFConsentUpdated Action = "finance.openfinance.consentUpdated"
	ActionOFConsentRemoved Action = "finance.openfinance.consentRemoved"
	ActionOFAccountSynced  Action = "finance.openfinance.accountSynced"
	// Open Finance — "pegar tudo": cartões, faturas, empréstimos,
	// financiamentos, câmbio, movimentações de investimento e a captura RAW.
	ActionInvestmentTransactionSynced Action = "finance.investment.transactionSynced"
	ActionOFCreditCardSynced         Action = "finance.openfinance.creditCardSynced"
	ActionOFBillSynced               Action = "finance.openfinance.billSynced"
	ActionOFLoanSynced               Action = "finance.openfinance.loanSynced"
	ActionOFFinancingSynced          Action = "finance.openfinance.financingSynced"
	ActionOFExchangeSynced           Action = "finance.openfinance.exchangeSynced"
	ActionOFRawSynced                Action = "finance.openfinance.rawSynced"
	// Notificações (regras que a pessoa cadastra).
	ActionNotifSet    Action = "finance.notification.set"
	ActionNotifDelete Action = "finance.notification.delete"

	// Prospecta (specs/004-prospecta): o primeiro vertical slice do produto de
	// prospecção agêntica. Diferente das demais famílias, a action é o nome do
	// comando em PascalCase, o formato do contrato (§7.2/
	// contracts/domain-api-extensions.md); a prospecta-api (ACL, sem banco)
	// traduz o comando e o domain-worker aplica e grava a auditoria.
	ActionCreateCompany Action = "CreateCompany"
	ActionDefineICP     Action = "DefineICP"
	ActionCreateCampaign  Action = "CreateCampaign"
	ActionStartCampaign   Action = "StartCampaign"
	ActionRequestProspect Action = "RequestProspect"
	ActionUpsertLead      Action = "UpsertLead"
	ActionQualifyLead     Action = "QualifyLead"
	ActionDraftMessage    Action = "DraftMessage"
	ActionApproveMessage  Action = "ApproveMessage"
	ActionSendMessage     Action = "SendMessage"
	ActionReceiveReply    Action = "ReceiveReply"
	ActionBookMeeting     Action = "BookMeeting"
	// Autenticação: a conta e-mail+senha do Prospecta. O password_hash já
	// chega pronto (bcrypt) no payload — o worker só grava, nunca vê a senha
	// em claro.
	ActionCreateUser Action = "CreateUser"
	// Troca/definição de senha: reescreve prospecta_user.password_hash. O hash
	// já chega pronto (bcrypt); idempotente por command_id.
	ActionUpdateUserPassword Action = "UpdateUserPassword"
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
