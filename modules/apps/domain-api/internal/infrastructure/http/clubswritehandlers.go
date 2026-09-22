// clubs write doors: the routes the clubs services call to produce their
// commands. Structural writes (club, partida, watchlist, claim, notify) go
// through /sync so the caller confirms the record landed — the same shape
// cch-api uses for room create. The append-only high-volume ones (snapshot,
// anuncio) use the normal async 202 path, because nobody waits for them.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/clubs"
)

type ClubsWriteHandlers struct {
	commands application.CommandPublisher
	log      *slog.Logger
}

func NewClubsWriteHandlers(commands application.CommandPublisher, log *slog.Logger) *ClubsWriteHandlers {
	return &ClubsWriteHandlers{commands: commands, log: log}
}

// Club ingests — the ingest worker calls these. Structural, so they travel
// the sync path: the worker must not move on believing a club exists when it
// does not.

func (h *ClubsWriteHandlers) UpsertClub(w http.ResponseWriter, r *http.Request) {
	var in appclubs.UpsertClubInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.ClubID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "club_id is required"})
		return
	}
	h.publish(w, r, application.ActionUpsertClub, in)
}

func (h *ClubsWriteHandlers) UpsertTotais(w http.ResponseWriter, r *http.Request) {
	var in appclubs.TotaisInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	in.ClubID = chi.URLParam(r, "clubId")
	if in.ClubID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "club_id is required"})
		return
	}
	h.publish(w, r, application.ActionUpsertClubeTotais, in)
}

func (h *ClubsWriteHandlers) UpsertMatch(w http.ResponseWriter, r *http.Request) {
	var in appclubs.PartidaInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.MatchID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "match_id is required"})
		return
	}
	h.publish(w, r, application.ActionUpsertPartida, in)
}

// AppendSnapshot uses the async 202 path: it is append-only, high volume and
// nobody waits for the answer.
func (h *ClubsWriteHandlers) AppendSnapshot(w http.ResponseWriter, r *http.Request) {
	var in appclubs.SnapshotInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	in.ClubID = chi.URLParam(r, "clubId")
	if in.ClubID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "club_id is required"})
		return
	}
	h.publish(w, r, application.ActionAppendSnapshot, in)
}

func (h *ClubsWriteHandlers) CreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	var in appclubs.AnuncioInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	h.publish(w, r, application.ActionCreateAnuncio, in)
}

// Person writes — clubs-api calls these. Structural (the person expects to
// see the change), so they travel the sync path.

func (h *ClubsWriteHandlers) SetWatch(w http.ResponseWriter, r *http.Request) {
	var in appclubs.WatchInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.UsuarioEmail == "" || in.ClubID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "usuario_email and club_id are required"})
		return
	}
	h.publish(w, r, application.ActionSetWatch, in)
}

func (h *ClubsWriteHandlers) SaveNotifications(w http.ResponseWriter, r *http.Request) {
	var in appclubs.NotifyInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.UsuarioEmail == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "usuario_email is required"})
		return
	}
	h.publish(w, r, application.ActionSaveNotify, in)
}

func (h *ClubsWriteHandlers) ClaimPro(w http.ResponseWriter, r *http.Request) {
	var in appclubs.ClaimInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.UsuarioEmail == "" || in.PlayerID == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "usuario_email and player_id are required"})
		return
	}
	h.publish(w, r, application.ActionClaimPro, in)
}

func (h *ClubsWriteHandlers) SaveSyncRun(w http.ResponseWriter, r *http.Request) {
	var in appclubs.SyncRunInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if in.UsuarioEmail == "" {
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{Error: "usuario_email is required"})
		return
	}
	h.publish(w, r, application.ActionSaveSyncRun, in)
}

func (h *ClubsWriteHandlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.log.ErrorContext(r.Context(), "marshal clubs command", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.log.ErrorContext(r.Context(), "publish clubs command", "error", err)
		writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}
