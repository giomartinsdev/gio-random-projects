package httpapi

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	domaindashboardlayout "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/dashboardlayout"
)

// DashboardLayoutHandlers is read-only: saving/deleting a layout
// (dashboardlayout.save, dashboardlayout.delete) go through the generic
// POST /sync route by the caller directly -- see synchandlers.go's doc
// comment for why.
type DashboardLayoutHandlers struct {
	layouts domaindashboardlayout.Repository
	log     Logger
}

func NewDashboardLayoutHandlers(layouts domaindashboardlayout.Repository, log Logger) *DashboardLayoutHandlers {
	return &DashboardLayoutHandlers{layouts: layouts, log: log}
}

// GetDashboardLayout 404s when the usuario has no saved layout yet --
// the frontend falls back to its own embedded default in that case.
func (h *DashboardLayoutHandlers) GetDashboardLayout(w http.ResponseWriter, r *http.Request) {
	usuario := chi.URLParam(r, "usuario")
	layout, err := h.layouts.FindByUsuario(r.Context(), usuario)
	if errors.Is(err, domaindashboardlayout.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "dashboard layout not found"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, toDashboardLayoutResponse(layout))
}

func (h *DashboardLayoutHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
