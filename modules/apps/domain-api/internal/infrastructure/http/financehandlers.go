// finance handlers: domain-api's read surface for the finance bounded context
// (docs/finance-system-spec.md §4.2). Reads go straight to Postgres — the
// synchronous path — and are projections only; domain-worker is the sole
// writer of the finance tables (§1.1).
//
// The finance-api relays these to the WhatsApp worker and the SPA, so the
// shapes here are the contract: money is always a canonical decimal string,
// never a JSON number (§3.4 nº1).
package httpapi

import (
	"log/slog"
	"net/http"
	"regexp"

	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/finance"
)

// yyyymm matches the period key the finance context uses everywhere (the
// budget's "once per threshold per period" key is built on it, so a loose
// format would make the key unstable).
var yyyymm = regexp.MustCompile(`^\d{4}-\d{2}$`)
var yyyymmdd = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

type FinanceHandlers struct {
	reads domainfinance.ReadRepository
	log   *slog.Logger
}

func NewFinanceHandlers(reads domainfinance.ReadRepository, log *slog.Logger) *FinanceHandlers {
	return &FinanceHandlers{reads: reads, log: log}
}

func (h *FinanceHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "finance handler error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}

// financeUserID reads the required `user_id` (the caller's identity) and
// writes a 400 when it is missing — a summary with no owner is meaningless,
// and an empty owner would silently match zero rows instead of erroring.
func financeUserID(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "user_id is required"})
		return "", false
	}
	return userID, true
}

// GetDailySummary is §4.2 GetDailySummaryQuery: one day's income/expense/net.
// The day is a UTC calendar day; `date` defaults to... nothing — the caller
// names the day explicitly so "hoje" is decided in the user's timezone by the
// worker, not assumed here.
func (h *FinanceHandlers) GetDailySummary(w http.ResponseWriter, r *http.Request) {
	userID, ok := financeUserID(w, r)
	if !ok {
		return
	}
	date := r.URL.Query().Get("date")
	if !yyyymmdd.MatchString(date) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "date must be 'YYYY-MM-DD'"})
		return
	}
	summary, err := h.reads.DailySummary(r.Context(), userID, date)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

// GetMonthlyDashboard is §4.2 GetMonthlyDashboardQuery: totals, top expense
// categories and the month's budgets with their fired thresholds.
func (h *FinanceHandlers) GetMonthlyDashboard(w http.ResponseWriter, r *http.Request) {
	userID, ok := financeUserID(w, r)
	if !ok {
		return
	}
	month := r.URL.Query().Get("month")
	if !yyyymm.MatchString(month) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "month must be 'YYYY-MM'"})
		return
	}
	dashboard, err := h.reads.MonthlyDashboard(r.Context(), userID, month)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, dashboard)
}

// GetCategoryBreakdown is §4.2 GetCategoryBreakdownQuery: every expense
// category in the month, largest first.
func (h *FinanceHandlers) GetCategoryBreakdown(w http.ResponseWriter, r *http.Request) {
	userID, ok := financeUserID(w, r)
	if !ok {
		return
	}
	month := r.URL.Query().Get("month")
	if !yyyymm.MatchString(month) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "month must be 'YYYY-MM'"})
		return
	}
	breakdown, err := h.reads.CategoryBreakdown(r.Context(), userID, month)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, breakdown)
}

// GetCashFlowHistory is §4.2 GetCashFlowHistoryQuery: the month per day, in
// chronological order, for the chart engine.
func (h *FinanceHandlers) GetCashFlowHistory(w http.ResponseWriter, r *http.Request) {
	userID, ok := financeUserID(w, r)
	if !ok {
		return
	}
	month := r.URL.Query().Get("month")
	if !yyyymm.MatchString(month) {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "month must be 'YYYY-MM'"})
		return
	}
	history, err := h.reads.CashFlowHistory(r.Context(), userID, month)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, history)
}

// GetOFConsents is §4.2: as conexões Open Finance (consentimentos) do usuário.
func (h *FinanceHandlers) GetOFConsents(w http.ResponseWriter, r *http.Request) {
	userID, ok := financeUserID(w, r)
	if !ok {
		return
	}
	list, err := h.reads.OFConsents(r.Context(), userID)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// GetOFAccounts is §4.2: as contas bancárias importadas, com saldo.
func (h *FinanceHandlers) GetOFAccounts(w http.ResponseWriter, r *http.Request) {
	userID, ok := financeUserID(w, r)
	if !ok {
		return
	}
	list, err := h.reads.OFAccounts(r.Context(), userID)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}
