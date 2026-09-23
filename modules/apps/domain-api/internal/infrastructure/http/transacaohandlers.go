package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	apptransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/transacao"
	domaintransacao "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/transacao"
)

const transacaoDateLayout = "2006-01-02"

// TransacaoHandlers is the one aggregate here (besides ativo's quote
// route) that gets dedicated async write routes instead of the generic
// /sync: create/update/delete are all common, person-driven writes,
// worth validating and shaping at this boundary rather than leaving
// every caller to hand-build the /sync envelope.
type TransacaoHandlers struct {
	transacoes domaintransacao.Repository
	commands   application.CommandPublisher
	log        Logger
}

func NewTransacaoHandlers(transacoes domaintransacao.Repository, commands application.CommandPublisher, log Logger) *TransacaoHandlers {
	return &TransacaoHandlers{transacoes: transacoes, commands: commands, log: log}
}

// ListTransacoes requires ?usuario= -- conta, categoria, de and ate are
// optional filters. de/ate use YYYY-MM-DD (a date, not a timestamp).
func (h *TransacaoHandlers) ListTransacoes(w http.ResponseWriter, r *http.Request) {
	usuario := r.URL.Query().Get("usuario")
	if usuario == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "usuario query param is required"})
		return
	}
	conta := r.URL.Query().Get("conta")
	categoria := r.URL.Query().Get("categoria")

	from_division, err := parseOptionalDate(r.URL.Query().Get("from_division"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "from_division must be in YYYY-MM-DD format"})
		return
	}
	ate, err := parseOptionalDate(r.URL.Query().Get("ate"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "ate must be in YYYY-MM-DD format"})
		return
	}

	transacoes, err := h.transacoes.ListByFiltro(r.Context(), usuario, conta, categoria, from_division, ate)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"transacoes": toTransacaoResponses(transacoes)})
}

func parseOptionalDate(raw string) (*time.Time, error) {
	if raw == "" {
		return nil, nil
	}
	t, err := time.Parse(transacaoDateLayout, raw)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (h *TransacaoHandlers) CreateTransacao(w http.ResponseWriter, r *http.Request) {
	var input apptransacao.CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.UserEmail == "" || input.ContaID == "" || input.Kind == "" || input.Categoria == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "user_email, conta_id, kind and categoria are required"})
		return
	}
	if input.Valor <= 0 {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "valor must be greater than zero"})
		return
	}
	if input.Data.IsZero() {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "data is required"})
		return
	}
	h.publish(w, r, application.ActionCreateTransacao, input)
}

func (h *TransacaoHandlers) UpdateTransacao(w http.ResponseWriter, r *http.Request) {
	var input apptransacao.UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	input.ID = chi.URLParam(r, "id")
	if input.UserEmail == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "user_email is required"})
		return
	}
	if input.Valor < 0 {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "valor must be greater than zero"})
		return
	}
	h.publish(w, r, application.ActionUpdateTransacao, input)
}

func (h *TransacaoHandlers) DeleteTransacao(w http.ResponseWriter, r *http.Request) {
	var input apptransacao.DeleteInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	input.ID = chi.URLParam(r, "id")
	if input.UserEmail == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "user_email is required"})
		return
	}
	h.publish(w, r, application.ActionDeleteTransacao, input)
}

func (h *TransacaoHandlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
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

func (h *TransacaoHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
