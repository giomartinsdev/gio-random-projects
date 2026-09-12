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

	// Gestão financeira modular (specs/002). conta/dashboardlayout
	// writes and ativo.create/ativo.registerMovement all go through the
	// generic /sync route by the caller directly -- these constants exist
	// for type-safety wherever a comment or future caller builds those
	// commands from this package, not because domain-api has dedicated
	// handlers for them.
	ActionCreateConta Action = "conta.create"
	ActionUpdateConta Action = "conta.update"

	ActionCreateTransacao Action = "transacao.create"
	ActionUpdateTransacao Action = "transacao.update"
	ActionDeleteTransacao Action = "transacao.delete"

	ActionCreateAtivo           Action = "ativo.create"
	ActionRegisterAtivoMovement Action = "ativo.registerMovement"
	ActionUpdateAtivoQuote      Action = "ativo.updateQuote"

	ActionSaveDashboardLayout   Action = "dashboardlayout.save"
	ActionDeleteDashboardLayout Action = "dashboardlayout.delete"
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
