package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"testing"

	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/finance"
)

// stubFinanceReads implements domainfinance.ReadRepository by embedding the
// interface and overriding the four methods — an unimplemented call panics
// loudly rather than returning zeros.
type stubFinanceReads struct {
	domainfinance.ReadRepository

	daily     domainfinance.DailySummary
	dashboard domainfinance.MonthlyDashboard
	breakdown domainfinance.CategoryBreakdown
	cashflow  domainfinance.CashFlowHistory

	lastUser  string
	lastMonth string
	lastDate  string
}

func (s *stubFinanceReads) DailySummary(_ context.Context, userID, date string) (domainfinance.DailySummary, error) {
	s.lastUser, s.lastDate = userID, date
	return s.daily, nil
}
func (s *stubFinanceReads) MonthlyDashboard(_ context.Context, userID, month string) (domainfinance.MonthlyDashboard, error) {
	s.lastUser, s.lastMonth = userID, month
	return s.dashboard, nil
}
func (s *stubFinanceReads) CategoryBreakdown(_ context.Context, userID, month string) (domainfinance.CategoryBreakdown, error) {
	s.lastUser, s.lastMonth = userID, month
	return s.breakdown, nil
}
func (s *stubFinanceReads) CashFlowHistory(_ context.Context, userID, month string) (domainfinance.CashFlowHistory, error) {
	s.lastUser, s.lastMonth = userID, month
	return s.cashflow, nil
}

func financeServer(reads domainfinance.ReadRepository) http.Handler {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := NewFinanceHandlers(reads, log)
	mux := http.NewServeMux()
	mux.HandleFunc("/finance/daily-summary", h.GetDailySummary)
	mux.HandleFunc("/finance/monthly-dashboard", h.GetMonthlyDashboard)
	mux.HandleFunc("/finance/category-breakdown", h.GetCategoryBreakdown)
	mux.HandleFunc("/finance/cash-flow-history", h.GetCashFlowHistory)
	return mux
}

func TestFinanceReadRoutesRequireUserID(t *testing.T) {
	mux := financeServer(&stubFinanceReads{})
	for _, path := range []string{
		"/finance/daily-summary?date=2026-10-04",
		"/finance/monthly-dashboard?month=2026-10",
		"/finance/category-breakdown?month=2026-10",
		"/finance/cash-flow-history?month=2026-10",
	} {
		rec := getJSON(t, mux, path)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s sem user_id = %d; want 400", path, rec.Code)
		}
	}
}

func TestFinanceReadRoutesRejectBadPeriods(t *testing.T) {
	mux := financeServer(&stubFinanceReads{})
	cases := map[string]string{
		"/finance/daily-summary?user_id=u&date=04/10/2026":   "data não ISO",
		"/finance/daily-summary?user_id=u&date=2026-10":      "dia sem dia",
		"/finance/monthly-dashboard?user_id=u&month=2026":    "mês sem mês",
		"/finance/category-breakdown?user_id=u&month=abc":    "mês não numérico",
		"/finance/cash-flow-history?user_id=u&month=2026-1":  "mês de um dígito",
	}
	for path, why := range cases {
		rec := getJSON(t, mux, path)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s (%s) = %d; want 400", path, why, rec.Code)
		}
	}
}

func TestFinanceDailySummaryCarriesMoneyAsString(t *testing.T) {
	stub := &stubFinanceReads{daily: domainfinance.DailySummary{
		UserID: "u", Date: "2026-10-04", Income: "100.00", Expense: "-50.00",
		Net: "50.00", Currency: "BRL", TransactionCount: 3,
	}}
	rec := getJSON(t, financeServer(stub), "/finance/daily-summary?user_id=u&date=2026-10-04")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	// Decodifica num mapa cru: se o dinheiro virar número JSON, o decode para
	// string falha — é exatamente o que o §3.4 nº1 proíbe.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body não é JSON: %v", err)
	}
	if body["net"] != "50.00" {
		t.Fatalf("net = %v (%T); want a string \"50.00\"", body["net"], body["net"])
	}
	if stub.lastUser != "u" || stub.lastDate != "2026-10-04" {
		t.Fatalf("repo recebeu user=%q date=%q; want u/2026-10-04", stub.lastUser, stub.lastDate)
	}
}

func TestFinanceMonthlyDashboardShape(t *testing.T) {
	stub := &stubFinanceReads{dashboard: domainfinance.MonthlyDashboard{
		UserID: "u", Month: "2026-10", Income: "1000.00", Expense: "-80.00",
		Net: "920.00", Currency: "BRL", TransactionCount: 2,
		TopCategories: []domainfinance.CategoryAmount{{Category: "Alimentação", Amount: "-80.00", Currency: "BRL", TransactionCount: 1}},
		Budgets:       []domainfinance.BudgetStatus{{Category: "Alimentação", LimitAmount: "100.00", SpentAmount: "-80.00", Currency: "BRL", Thresholds: []int{50}}},
	}}
	rec := getJSON(t, financeServer(stub), "/finance/monthly-dashboard?user_id=u&month=2026-10")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	var got domainfinance.MonthlyDashboard
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Net != "920.00" || len(got.Budgets) != 1 || got.Budgets[0].Thresholds[0] != 50 {
		t.Fatalf("dashboard = %+v", got)
	}
	if stub.lastUser != "u" || stub.lastMonth != "2026-10" {
		t.Fatalf("repo recebeu user=%q month=%q", stub.lastUser, stub.lastMonth)
	}
}
