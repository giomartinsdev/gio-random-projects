package finance

import (
	"errors"
	"testing"
	"time"
)

// As invariantes do §3.4 que dão para provar sem banco: dinheiro exato (nunca
// float), moeda não se mistura, tz-aware, e réguas disparam exatamente nos
// limiares.

func TestParseMoneyIsExact(t *testing.T) {
	cases := map[string]int64{
		"45":       4500,
		"45.00":    4500,
		"45,00":    4500,
		"1.234,56": 123456,
		"-0.05":    -5,
		"0":        0,
		"3500.5":   350050,
	}
	for raw, want := range cases {
		m, err := ParseMoney(raw, "BRL")
		if err != nil {
			t.Fatalf("ParseMoney(%q): %v", raw, err)
		}
		if m.Cents != want {
			t.Fatalf("ParseMoney(%q) = %d centavos; want %d", raw, m.Cents, want)
		}
	}
}

func TestParseMoneyRejectsGarbage(t *testing.T) {
	for _, raw := range []string{"", "abc", "4.5.6", "12,3,4"} {
		if _, err := ParseMoney(raw, "BRL"); err == nil {
			t.Fatalf("ParseMoney(%q) devia falhar", raw)
		}
	}
	if _, err := ParseMoney("10", ""); !errors.Is(err, ErrCurrencyMissing) {
		t.Fatalf("sem moeda devia falhar com ErrCurrencyMissing")
	}
}

func TestMoneyAddIsExact(t *testing.T) {
	a, _ := ParseMoney("0.10", "BRL")
	b, _ := ParseMoney("0.20", "BRL")
	sum, err := a.Add(b)
	if err != nil {
		t.Fatal(err)
	}
	// O teste clássico de float: 0.1+0.2 = 0.30000000000000004 em float64.
	if sum.Decimal() != "0.30" {
		t.Fatalf("0.10 + 0.20 = %s; want 0.30 (float teria dado 0.30000000000000004)", sum.Decimal())
	}
}

func TestMoneyCannotMixCurrencies(t *testing.T) {
	brl, _ := ParseMoney("10", "BRL")
	usd, _ := ParseMoney("10", "USD")
	if _, err := brl.Add(usd); !errors.Is(err, ErrCurrencyMismatch) {
		t.Fatalf("somar moedas diferentes devia falhar")
	}
}

func TestNewTransactionRequiresUserAndType(t *testing.T) {
	amt, _ := ParseMoney("45", "BRL")
	now := time.Now().UTC()
	if _, err := NewTransaction("id", "", "acct", TypeExpense, amt, "x", now, ""); !errors.Is(err, ErrUserIDRequired) {
		t.Fatalf("sem user_id devia falhar")
	}
	if _, err := NewTransaction("id", "u", "acct", "NOPE", amt, "x", now, ""); !errors.Is(err, ErrTypeInvalid) {
		t.Fatalf("tipo inválido devia falhar")
	}
	if _, err := NewTransaction("id", "u", "acct", TypeExpense, amt, "x", time.Time{}, ""); !errors.Is(err, ErrOccurredAtRequired) {
		t.Fatalf("occurred_at zero devia falhar")
	}
}

func TestTransactionOccurredAtIsStoredUTC(t *testing.T) {
	amt, _ := ParseMoney("45", "BRL")
	// -03:00 explícito; armazenar em UTC é o §3.4 nº4.
	loc := time.FixedZone("BRT", -3*3600)
	when := time.Date(2026, 10, 4, 9, 0, 0, 0, loc)
	tx, err := NewTransaction("id", "u", "acct", TypeExpense, amt, "Alimentação", when, "")
	if err != nil {
		t.Fatal(err)
	}
	if tx.OccurredAt.Location() != time.UTC {
		t.Fatalf("occurred_at não está em UTC: %v", tx.OccurredAt.Location())
	}
	if tx.OccurredAt.Hour() != 12 {
		t.Fatalf("9h -03 deveria virar 12h UTC, veio %dh", tx.OccurredAt.Hour())
	}
}

func TestBudgetCrossedThresholdsAreIntegerExact(t *testing.T) {
	limit, _ := ParseMoney("100.00", "BRL")
	b, err := NewBudget("b1", "u", "Alimentação", limit, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	// 49,99 -> nenhuma régua; 79,99 -> só 50; 80,00 -> 50 e 80; 100,00 -> as três.
	spent := func(v string) int64 { m, _ := ParseMoney(v, "BRL"); return m.Cents }
	if got := b.CrossedThresholds(spent("49.99")); len(got) != 0 {
		t.Fatalf("49,99 não cruza nada, veio %v", got)
	}
	if got := b.CrossedThresholds(spent("79.99")); len(got) != 1 || got[0] != 50 {
		t.Fatalf("79,99 cruza só 50, veio %v", got)
	}
	if got := b.CrossedThresholds(spent("80.00")); len(got) != 2 || got[0] != 50 || got[1] != 80 {
		t.Fatalf("80,00 cruza 50 e 80, veio %v", got)
	}
	if got := b.CrossedThresholds(spent("100.00")); len(got) != 3 {
		t.Fatalf("100,00 cruza as três, veio %v", got)
	}
}

func TestNewBudgetValidates(t *testing.T) {
	limit, _ := ParseMoney("600", "BRL")
	if _, err := NewBudget("b", "u", "x", limit, "2026-1"); !errors.Is(err, ErrPeriodInvalid) {
		t.Fatalf("período inválido devia falhar")
	}
}
