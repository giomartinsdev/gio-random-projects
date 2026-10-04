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
	ActionTransferBetweenAccounts Action = "finance.transfer.betweenAccounts"
	ActionSetCategoryBudget      Action = "finance.budget.setCategory"
	// Open Finance (docs/openfinance-spec.md): o ciclo do consentimento e o
	// sync de conta. Publicados pela ACL / pelo conector.
	ActionOFConsentCreated Action = "finance.openfinance.consentCreated"
	ActionOFConsentUpdated Action = "finance.openfinance.consentUpdated"
	ActionOFConsentRemoved Action = "finance.openfinance.consentRemoved"
	ActionOFAccountSynced  Action = "finance.openfinance.accountSynced"
	// Notificações (regras que a pessoa cadastra).
	ActionNotifSet    Action = "finance.notification.set"
	ActionNotifDelete Action = "finance.notification.delete"
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
