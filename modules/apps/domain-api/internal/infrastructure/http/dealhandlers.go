package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	appdeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/deal"
	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/deal"
)

// DealHandlers is separate from Handlers/PostHandlers on purpose —
// each aggregate gets its own dependencies instead of one struct
// accumulating every repository/port in the codebase.
type DealHandlers struct {
	deals    domaindeal.Repository
	commands application.CommandPublisher
	log      Logger
}

func NewDealHandlers(deals domaindeal.Repository, commands application.CommandPublisher, log Logger) *DealHandlers {
	return &DealHandlers{deals: deals, commands: commands, log: log}
}

// CreateDeal is the ingest write: a scraper pushes what it saw, this
// never touches Postgres — it publishes deal.upsert and domain-worker
// decides insert vs update (and therefore whether deal.created ever
// reaches the event queue). 202 means "heard, queued", not "stored" —
// same semantics as every other write here.
func (h *DealHandlers) CreateDeal(w http.ResponseWriter, r *http.Request) {
	var input appdeal.UpsertInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.Source == "" || input.SourceDealID == "" || input.Title == "" || input.URL == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "source, source_deal_id, title and url are required"})
		return
	}
	h.publishDeal(w, r, application.ActionUpsertDeal, input)
}

func (h *DealHandlers) ListDeals(w http.ResponseWriter, r *http.Request) {
	source := strings.TrimSpace(r.URL.Query().Get("source"))

	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil || parsed < 1 {
			writeJSON(w, http.StatusBadRequest, errorBody{Error: "limit must be a positive integer"})
			return
		}
		limit = parsed
	}
	if limit > 200 {
		limit = 200
	}

	deals, err := h.deals.ListRecent(r.Context(), source, limit)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deals": toDealResponses(deals)})
}

func (h *DealHandlers) GetDeal(w http.ResponseWriter, r *http.Request) {
	d, err := h.deals.FindByKey(r.Context(), chi.URLParam(r, "source"), chi.URLParam(r, "sourceDealID"))
	if errors.Is(err, domaindeal.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "deal not found"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, toDealResponse(d))
}

func (h *DealHandlers) publishDeal(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
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

func (h *DealHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
