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
)

type Command struct {
	ID      string          `json:"id"`
	Action  Action          `json:"action"`
	Payload json.RawMessage `json:"payload,omitempty"`
}
