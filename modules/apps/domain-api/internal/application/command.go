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
	// FC Clubs Hub (specs/003). The ingest worker produces the public-data
	// writes; clubs-api produces the per-person ones. Structural writes
	// (club, partida, watchlist, claim, notifications) go through /sync so
	// the caller knows the record landed; the high-volume append-only ones
	// (snapshot, anuncio) use the normal async 202 path.
	ActionUpsertClub        Action = "club.upsert"
	ActionUpsertClubeTotais Action = "clubetotais.upsert"
	ActionUpsertPartida     Action = "partida.upsert"
	ActionAppendSnapshot    Action = "clubesnapshot.append"
	ActionCreateAnuncio     Action = "anuncio.create"
	ActionSaveCareer        Action = "clubs.careerSave"

	ActionSetWatch    Action = "preferencia.setWatch"
	ActionRemoveWatch Action = "preferencia.removeWatch"
	ActionSaveNotify  Action = "preferencia.saveNotificacoes"
	ActionClaimPro    Action = "preferencia.claimPro"
	ActionSaveSyncRun Action = "preferencia.saveSyncRun"

	// Fila de fetch sob demanda de um clube: a tela de resgate pede, o worker
	// de ingestão busca o elenco, e o estado volta para a SPA.
	ActionRequestFetch Action = "clubs.fetchRun"
	ActionSaveFetch    Action = "clubs.fetchRunSave"

	// Busca ao vivo na fonte, para um clube que o hub ainda não viu.
	ActionRequestSearch Action = "clubs.searchRun"
	ActionSaveSearch    Action = "clubs.searchRunSave"

	// Financeiro (docs/finance-system-spec.md §4.1): a família finance.* que a
	// finance-api relaya. O domain-api só a publica; quem aplica é o
	// domain-worker.
	ActionRegisterTransaction     Action = "finance.transaction.register"
	ActionCategorizeTransaction   Action = "finance.transaction.categorize"
	// Correção pelo próprio usuário (SPA): editar/remover um lançamento já
	// registrado. O domain-api só publica; quem aplica (e valida posse, §3.4
	// nº3) é o domain-worker.
	ActionUpdateTransaction       Action = "finance.transaction.update"
	ActionRemoveTransaction       Action = "finance.transaction.remove"
	// Flag de movimentação entre contas próprias (BTG → MP): inativo sai de
	// receitas/despesas/net/categorias/cashflow, mas fica no saldo da conta.
	ActionSetTransactionActive    Action = "finance.transaction.setActive"
	ActionTransferBetweenAccounts Action = "finance.transfer.betweenAccounts"
	ActionSetCategoryBudget       Action = "finance.budget.setCategory"

	// Prospecta (specs/004-prospecta): Company + ICP. A action é o nome do
	// comando em PascalCase, o formato do contrato (§7.2); a prospecta-api
	// relaya este envelope e o domain-worker aplica.
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
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
