// Package application is domain-worker's use-case layer: the Command
// envelope, ports (what infrastructure must provide), and one
// subpackage per aggregate wiring the two together. domain-api has its
// own, smaller copy of this package (just Command + CommandPublisher)
// since it only ever produces commands, never applies them.
package application

import "encoding/json"

type Action string

const (
	ActionCreateUser Action = "user.create"
	ActionUpdateUser Action = "user.update"
	ActionDeleteUser Action = "user.delete"

	ActionCreatePost Action = "post.create"
	ActionUpdatePost Action = "post.update"
	ActionDeletePost Action = "post.delete"

	ActionCreateRoom Action = "room.create"
	ActionUpdateRoom Action = "room.update"
	ActionDeleteRoom Action = "room.delete"

	ActionCreateMessage Action = "message.create"

	ActionUpsertDeal Action = "deal.upsert"

	// cch.giomartins.dev's registry writes (see internal/domain/cchroom
	// and internal/domain/cchdeck). cch-api is the only producer; its
	// structural writes (room create/delete, deck publish) go through
	// domain-api's POST /sync so the record is confirmed written before
	// the game answers, and its cosmetic one (deck play count) through
	// the normal async route.
	ActionCreateCCHRoom Action = "cchroom.create"
	ActionDeleteCCHRoom Action = "cchroom.delete"
	ActionUpsertCCHDeck Action = "cchdeck.upsert"
	// The play count is fire-and-forget (a lost count only makes a
	// marketplace badge slightly stale), so it's the one CCH write that
	// travels the platform's default path: POST /cch/decks/{id}/plays →
	// 202 → this action.
	ActionPlayCCHDeck Action = "cchdeck.play"

	// Gestao financeira modular (specs/002): usuario_email (from the
	// Cloudflare Access JWT) partitions every one of these aggregates
	// between people the same way host_id partitions rooms.
	ActionCreateConta Action = "conta.create"
	ActionUpdateConta Action = "conta.update"

	ActionCreateTransacao Action = "transacao.create"
	ActionUpdateTransacao Action = "transacao.update"
	ActionDeleteTransacao Action = "transacao.delete"

	ActionCreateAtivo            Action = "ativo.create"
	ActionRegisterAtivoMovimento Action = "ativo.registerMovement"
	// ActionUpdateAtivoQuote skips the domain aggregate -- see
	// application/ativo.Service.UpdateQuote.
	ActionUpdateAtivoQuote Action = "ativo.updateQuote"

	ActionSaveDashboardLayout   Action = "dashboardlayout.save"
	ActionDeleteDashboardLayout Action = "dashboardlayout.delete"

	// ActionCaptureLead is leads-api's only write -- an e-mail captured
	// on financas-frontend's public landing page, before that person
	// ever authenticates.
	ActionCaptureLead Action = "lead.create"

	// Aposta (specs' betting-house wallet module): a single event with
	// its own lifecycle, not an accumulating position like Ativo. The
	// stake debit / payout credit are separate transacao.create
	// commands apostas-api publishes around these -- domain-worker
	// never crosses aggregates itself, same as everywhere else.
	ActionRegistrarAposta Action = "aposta.registrar"
	ActionResolverAposta  Action = "aposta.resolver"

	// FC Clubs Hub (specs/003): public Pro Clubs data accumulated from the
	// EA source. The ingest worker is the only producer of club/partida/
	// snapshot/anuncio writes; clubs-api produces the per-person ones
	// (watchlist, claimed pro, notifications preferences).
	ActionUpsertClub        Action = "club.upsert"
	ActionUpsertClubeTotais Action = "clubetotais.upsert"
	ActionUpsertPartida     Action = "partida.upsert"
	ActionAppendSnapshot    Action = "clubesnapshot.append"
	ActionCreateAnuncio     Action = "anuncio.create"
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
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
