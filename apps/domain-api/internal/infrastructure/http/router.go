package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter wires every route. /healthz and the API docs stay public
// (no key, no rate limit) — everything under /finance and /sync requires
// the apiKey security scheme (see openapi.yaml and Secure in
// middleware.go). /sync is the synchronous-write exception — see
// SyncHandlers.Sync's doc comment before reaching for it.
func NewRouter(h *Handlers, sync *SyncHandlers, fin *FinanceHandlers, env *EnvelopeHandlers, keys APIKeys, limiter *IPRateLimiter, log *slog.Logger) http.Handler {
	r := chi.NewRouter()

	r.Get("/healthz", h.Healthz)
	r.Get("/openapi.yaml", ServeOpenAPISpec)
	r.Get("/docs", ServeDocs)

	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return Secure(next, keys, limiter, log)
		})

		// /sync is the documented synchronous-write exception: the
		// caller waits for the worker's audit row before moving on.
		r.Post("/sync", sync.Sync)

		// /commands is the asynchronous envelope door (§4.1): it decodes the
		// bare {action, payload} and answers 202 immediately. This is what the
		// finance-api's default write path relays to; /sync stays for callers
		// that must not proceed until the write is durable.
		r.Post("/commands", env.Publish)

		// Financeiro (spec docs/finance-system-spec.md §4.2): leituras puras
		// servidas das projeções. A finance-api não tem banco e relaya estes
		// GETs; o domain-worker é o único escritor das tabelas finance_*.
		r.Get("/finance/daily-summary", fin.GetDailySummary)
		r.Get("/finance/monthly-dashboard", fin.GetMonthlyDashboard)
		r.Get("/finance/category-breakdown", fin.GetCategoryBreakdown)
		r.Get("/finance/cash-flow-history", fin.GetCashFlowHistory)
		// Open Finance: conexões e contas importadas (projeções read-only).
		r.Get("/finance/transactions", fin.GetTransactions)
		r.Get("/finance/transaction", fin.GetTransaction)
		r.Get("/finance/notifications", fin.GetNotifications)
		r.Get("/finance/openfinance/consents", fin.GetOFConsents)
		r.Get("/finance/openfinance/accounts", fin.GetOFAccounts)
		// Investimentos (posições/rendimentos importados do Open Finance).
		r.Get("/finance/investments", fin.GetInvestments)
		r.Get("/finance/credit-cards", fin.GetCreditCards)
		r.Get("/finance/bills", fin.GetBills)
		r.Get("/finance/loans", fin.GetLoans)
		r.Get("/finance/financings", fin.GetFinancings)
		r.Get("/finance/exchanges", fin.GetExchanges)
		r.Get("/finance/investment-transactions", fin.GetInvestmentTransactions)
		r.Get("/finance/openfinance/raw", fin.GetOFRaw)
	})

	return r
}
