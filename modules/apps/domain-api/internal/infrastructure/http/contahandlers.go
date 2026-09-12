package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	domainconta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/conta"
)

// ContaHandlers is read-only: creation/update (conta.create,
// conta.update) go through the generic POST /sync route by the caller
// directly -- see synchandlers.go's doc comment for why.
type ContaHandlers struct {
	contas domainconta.Repository
	log    Logger
}

func NewContaHandlers(contas domainconta.Repository, log Logger) *ContaHandlers {
	return &ContaHandlers{contas: contas, log: log}
}

// ListContas requires ?usuario= -- there is no "list every conta ever
// created" use case, only "this usuario's contas".
func (h *ContaHandlers) ListContas(w http.ResponseWriter, r *http.Request) {
	usuario := r.URL.Query().Get("usuario")
	if usuario == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "usuario query param is required"})
		return
	}
	status := r.URL.Query().Get("status")
	contas, err := h.contas.ListByUsuario(r.Context(), usuario, status)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"contas": toContaResponses(contas)})
}

func (h *ContaHandlers) GetConta(w http.ResponseWriter, r *http.Request) {
	conta, err := h.contas.FindByID(r.Context(), chi.URLParam(r, "id"))
	if errors.Is(err, domainconta.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "conta not found"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, toContaResponse(conta))
}

func (h *ContaHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
