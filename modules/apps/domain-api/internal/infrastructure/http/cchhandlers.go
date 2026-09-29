package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	domaincchdeck "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/cchdeck"
	domaincchroom "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/cchroom"
)

// CCHHandlers serves cch-api's boot load: the whole room registry and
// the whole deck marketplace, read straight from Postgres. There are no
// write routes here on purpose — cch-api's writes go through /sync (or
// the async 202 pattern), land in cch_rooms/cch_custom_decks via
// domain-worker, and come back out through these reads on its next
// boot. Both lists are server-to-server payloads behind the API key:
// rooms carry password hashes and resume keys, decks carry full card
// texts that the browser-facing marketplace must never see.
type CCHHandlers struct {
	rooms    domaincchroom.Repository
	decks    domaincchdeck.Repository
	commands application.CommandPublisher
	log      Logger
}

func NewCCHHandlers(rooms domaincchroom.Repository, decks domaincchdeck.Repository, commands application.CommandPublisher, log Logger) *CCHHandlers {
	return &CCHHandlers{rooms: rooms, decks: decks, commands: commands, log: log}
}

// cchRoomResponse mirrors the storage row one-to-one. []byte fields
// marshal as base64 strings (encoding/json's default), which is also
// how cch-api sends them inside the cchroom.create payload — so the
// bytes that went in are the bytes that come back out.
type cchRoomResponse struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	Salt      []byte    `json:"salt"`
	Hash      []byte    `json:"hash"`
	ResumeKey []byte    `json:"resume_key"`
}

func toCCHRoomResponses(rooms []domaincchroom.Room) []cchRoomResponse {
	out := make([]cchRoomResponse, 0, len(rooms))
	for _, room := range rooms {
		out = append(out, cchRoomResponse{
			ID:        room.ID,
			CreatedAt: room.CreatedAt,
			Salt:      room.Salt,
			Hash:      room.Hash,
			ResumeKey: room.ResumeKey,
		})
	}
	return out
}

// cchDeckResponse is the full record — cards included. cch-api derives
// card ids and strips the texts before anything reaches a browser; this
// endpoint is not that path.
type cchDeckResponse struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Emoji       string    `json:"emoji"`
	Description string    `json:"description"`
	ParentID    string    `json:"parent_id"`
	Author      string    `json:"author"`
	Whites      []string  `json:"whites"`
	Blacks      []string  `json:"blacks"`
	CreatedAt   time.Time `json:"created_at"`
	Plays       int       `json:"plays"`
}

func toCCHDeckResponses(decks []domaincchdeck.Deck) []cchDeckResponse {
	out := make([]cchDeckResponse, 0, len(decks))
	for _, deck := range decks {
		out = append(out, cchDeckResponse{
			ID:          deck.ID,
			Name:        deck.Name,
			Emoji:       deck.Emoji,
			Description: deck.Description,
			ParentID:    deck.ParentID,
			Author:      deck.Author,
			Whites:      deck.Whites,
			Blacks:      deck.Blacks,
			CreatedAt:   deck.CreatedAt,
			Plays:       deck.Plays,
		})
	}
	return out
}

func (h *CCHHandlers) ListCCHRooms(w http.ResponseWriter, r *http.Request) {
	rooms, err := h.rooms.List(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": toCCHRoomResponses(rooms)})
}

func (h *CCHHandlers) ListCCHDecks(w http.ResponseWriter, r *http.Request) {
	decks, err := h.decks.List(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"decks": toCCHDeckResponses(decks)})
}

// PlayCCHDeck is the play count's async door (the platform's default
// write shape, unlike the structural CCH writes which use /sync): it
// publishes cchdeck.play and answers 202 without waiting. The count is
// cosmetic — a dropped bump costs a marketplace badge a digit, not a
// game its room.
func (h *CCHHandlers) PlayCCHDeck(w http.ResponseWriter, r *http.Request) {
	h.publish(w, r, "cchdeck.play", map[string]string{"id": chi.URLParam(r, "id")})
}

func (h *CCHHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}

// publish is RoomHandlers' exact same dance, local to this handler set:
// marshal → envelope with a fresh id → 202.
func (h *CCHHandlers) publish(w http.ResponseWriter, r *http.Request, action string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: application.Action(action), Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}
