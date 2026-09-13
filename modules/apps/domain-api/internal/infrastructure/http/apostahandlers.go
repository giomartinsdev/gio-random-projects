package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	domainaposta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/aposta"
)

// ApostaHandlers is read-only: registrar/resolver (aposta.registrar,
// aposta.resolver) go through the generic POST /sync route by the
// caller directly -- see synchandlers.go's doc comment for why.
type ApostaHandlers struct {
	apostas domainaposta.Repository
	log     Logger
}

func NewApostaHandlers(apostas domainaposta.Repository, log Logger) *ApostaHandlers {
	return &ApostaHandlers{apostas: apostas, log: log}
}

// ListApostas requires ?usuario= -- conta is an optional narrowing
// filter, same convention as ListAtivos.
func (h *ApostaHandlers) ListApostas(w http.ResponseWriter, r *http.Request) {
	usuario := r.URL.Query().Get("usuario")
	if usuario == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "usuario query param is required"})
		return
	}
	conta := r.URL.Query().Get("conta")
	apostas, err := h.apostas.ListByUsuario(r.Context(), usuario, conta)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"apostas": toApostaResponses(apostas)})
}

func (h *ApostaHandlers) GetAposta(w http.ResponseWriter, r *http.Request) {
	aposta, err := h.apostas.FindByID(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, domainaposta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "aposta not found"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, toApostaResponse(aposta))
}

func (h *ApostaHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
