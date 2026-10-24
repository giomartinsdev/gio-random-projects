package main

import (
	"encoding/json"
	"testing"

	appfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/finance"
)

func mustUnmarshal(t *testing.T, payload string, dst any) {
	t.Helper()
	if err := json.Unmarshal([]byte(payload), dst); err != nil {
		t.Fatalf("unmarshal %s: %v", payload, err)
	}
}

// Os payloads finance.* são cópias do que a finance-api publica (o envelope
// {action, payload} que ela relaya). Mesma regra do clubs: um rename de um lado
// só vira campo zero em silêncio. Trava o contrato contra os campos que o
// domain-worker realmente lê.
func TestFinanceCommandPayloadsMatchProducers(t *testing.T) {
	t.Run("register transaction", func(t *testing.T) {
		var in appfinance.RegisterTransactionInput
		mustUnmarshal(t, `{"user_id":"5521981962914","account_id":"acct-1","transaction_type":"EXPENSE","amount":"45.00","currency":"BRL","category":"Alimentação","occurred_at":"2026-10-04T12:00:00+00:00","source_type":"WHATSAPP_MANUAL"}`, &in)
		if in.UserID != "5521981962914" || in.Type != "EXPENSE" || in.Amount != "45.00" || in.Currency != "BRL" {
			t.Fatalf("payload de register não decodificou: %+v", in)
		}
	})
	t.Run("categorize transaction", func(t *testing.T) {
		var in appfinance.CategorizeTransactionInput
		mustUnmarshal(t, `{"transaction_id":"x","category":"Lazer"}`, &in)
		if in.TransactionID != "x" || in.Category != "Lazer" {
			t.Fatalf("payload de categorize não decodificou: %+v", in)
		}
	})
	t.Run("transfer between accounts", func(t *testing.T) {
		var in appfinance.TransferBetweenAccountsInput
		mustUnmarshal(t, `{"user_id":"u","from_account_id":"a","to_account_id":"b","amount":"100.00","currency":"BRL","occurred_at":"2026-10-04T12:00:00+00:00"}`, &in)
		if in.FromAccountID != "a" || in.ToAccountID != "b" || in.Amount != "100.00" {
			t.Fatalf("payload de transfer não decodificou: %+v", in)
		}
	})
	t.Run("set category budget", func(t *testing.T) {
		var in appfinance.SetCategoryBudgetInput
		mustUnmarshal(t, `{"user_id":"u","category":"Alimentação","limit":"600.00","currency":"BRL","period":"2026-10"}`, &in)
		if in.Category != "Alimentação" || in.Limit != "600.00" || in.Period != "2026-10" {
			t.Fatalf("payload de budget não decodificou: %+v", in)
		}
	})
}
