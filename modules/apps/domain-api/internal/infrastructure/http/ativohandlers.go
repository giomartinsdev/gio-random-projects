package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/ativo"
	domainativo "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/ativo"
	domainativomovimento "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/ativomovimento"
)

// AtivoHandlers is mostly read-only: ativo.create and
// ativo.registerMovement go through the generic POST /sync route by the
// caller directly. The one dedicated async route here is the quote
// update -- it's polled in the background by asset-manager-api, not
// driven by a person waiting on the response, so 202-and-forget fits.
type AtivoHandlers struct {
	ativos     domainativo.Repository
	movimentos domainativomovimento.Repository
	commands   application.CommandPublisher
	log        Logger
}

func NewAtivoHandlers(ativos domainativo.Repository, movimentos domainativomovimento.Repository, commands application.CommandPublisher, log Logger) *AtivoHandlers {
	return &AtivoHandlers{ativos: ativos, movimentos: movimentos, commands: commands, log: log}
}

// ListAtivos requires ?usuario= -- conta is an optional narrowing filter.
func (h *AtivoHandlers) ListAtivos(w http.ResponseWriter, r *http.Request) {
	usuario := r.URL.Query().Get("usuario")
	if usuario == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "usuario query param is required"})
		return
	}
	conta := r.URL.Query().Get("conta")
	ativos, err := h.ativos.ListByUsuario(r.Context(), usuario, conta)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ativos": toAtivoResponses(ativos)})
}

func (h *AtivoHandlers) GetAtivoMovimentos(w http.ResponseWriter, r *http.Request) {
	ativoID := chi.URLParam(r, "id")
	// Confirm the ativo itself exists so a bad id 404s instead of
	// silently answering an empty movimentos list.
	if _, err := h.ativos.FindByID(r.Context(), ativoID); errors.Is(err, domainativo.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "ativo not found"})
		return
	} else if err != nil {
		h.internalError(r, w, err)
		return
	}
	movimentos, err := h.movimentos.ListByAtivo(r.Context(), ativoID)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"movimentos": toAtivoMovimentoResponses(movimentos)})
}

// UpdateAtivoQuote publishes ativo.updateQuote and returns immediately
// -- asset-manager-api calls this from a background poller, not on
// behalf of a waiting person, so there's nothing to block on.
func (h *AtivoHandlers) UpdateAtivoQuote(w http.ResponseWriter, r *http.Request) {
	ativoID := chi.URLParam(r, "id")
	var body struct {
		Cotacao  float64   `json:"cotacao"`
		ObtidaEm time.Time `json:"obtida_em"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if body.Cotacao <= 0 {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "cotacao must be greater than zero"})
		return
	}
	if body.ObtidaEm.IsZero() {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "obtida_em is required"})
		return
	}
	input := appativo.UpdateQuoteInput{AtivoID: ativoID, Cotacao: body.Cotacao, ObtidaEm: body.ObtidaEm}
	h.publish(w, r, application.ActionUpdateAtivoQuote, input)
}

func (h *AtivoHandlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

func (h *AtivoHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
