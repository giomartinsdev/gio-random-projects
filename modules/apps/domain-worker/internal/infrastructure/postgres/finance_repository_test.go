package postgres

import (
	"context"
	"testing"
	"time"

	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/finance"
)

// As invariantes do §3.4 que só um banco real prova: idempotência por comando,
// transferência atômica, e a régua de orçamento disparando uma única vez.

func financeMoney(t *testing.T, raw string) domainfinance.Money {
	t.Helper()
	m, err := domainfinance.ParseMoney(raw, "BRL")
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return m
}

func financeTx(t *testing.T, id, user, acct string, typ domainfinance.TransactionType, amount, category string) domainfinance.Transaction {
	t.Helper()
	tx, err := domainfinance.NewTransaction(id, user, acct, typ, financeMoney(t, amount), category,
		time.Now().UTC(), "WHATSAPP_MANUAL")
	if err != nil {
		t.Fatalf("new transaction: %v", err)
	}
	return tx
}

func TestFinanceInsertIsIdempotentByID(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewFinanceRepository(pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM finance_transactions WHERE user_id = 'fin-user-idem'`)
	})

	tx := financeTx(t, "11111111-1111-1111-1111-111111111111", "fin-user-idem", "acct", domainfinance.TypeExpense, "45.00", "Alimentação")

	inserted, err := repo.Insert(ctx, tx)
	if err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if !inserted {
		t.Fatal("first insert must report inserted")
	}
	// A MESMA entrega do comando (at-least-once) não pode duplicar.
	inserted, err = repo.Insert(ctx, tx)
	if err != nil {
		t.Fatalf("second insert: %v", err)
	}
	if inserted {
		t.Fatal("second insert of the same id must NOT insert again")
	}

	got, err := repo.FindByID(ctx, tx.ID)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.Amount.Decimal() != "45.00" {
		t.Fatalf("amount drifted: %s", got.Amount.Decimal())
	}
}

func TestFinanceTransferIsAtomic(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewFinanceRepository(pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM finance_transactions WHERE user_id = 'fin-user-tr'`)
	})

	when := time.Now().UTC()
	debit := financeTx(t, "22222222-2222-2222-2222-222222222222", "fin-user-tr", "from", domainfinance.TypeTransfer, "-100.00", "")
	debit.OccurredAt = when
	credit := financeTx(t, "33333333-3333-3333-3333-333333333333", "fin-user-tr", "to", domainfinance.TypeTransfer, "100.00", "")
	credit.OccurredAt = when

	if err := repo.InsertTransfer(ctx, debit, credit); err != nil {
		t.Fatalf("transfer: %v", err)
	}
	// Os dois lados existem; o saldo líquido é zero (débito + crédito).
	var net string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount),0)::text FROM finance_transactions WHERE user_id = 'fin-user-tr'`).Scan(&net); err != nil {
		t.Fatalf("net: %v", err)
	}
	if net != "0.00" {
		t.Fatalf("net após transferência = %s; want 0.00", net)
	}
}

func TestFinanceBudgetThresholdFiresOnce(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewFinanceRepository(pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM finance_transactions WHERE user_id = 'fin-user-bud'`)
		_, _ = pool.Exec(ctx, `DELETE FROM finance_budgets WHERE user_id = 'fin-user-bud'`)
		_, _ = pool.Exec(ctx, `DELETE FROM finance_budget_thresholds WHERE budget_id = '77777777-7777-7777-7777-777777777777'`)
	})

	b, err := domainfinance.NewBudget("77777777-7777-7777-7777-777777777777", "fin-user-bud", "Alimentação", financeMoney(t, "100.00"), "2026-10")
	if err != nil {
		t.Fatalf("budget: %v", err)
	}
	if _, err := repo.UpsertBudget(ctx, b); err != nil {
		t.Fatalf("upsert budget: %v", err)
	}
	// Gasto de 80,00 -> cruza 50. O disparo grava; o segundo é false (§3.4 nº5).
	fired, err := repo.RecordThreshold(ctx, b, 50, b.Period, "80.00", "100.00")
	if err != nil {
		t.Fatalf("record first: %v", err)
	}
	if !fired {
		t.Fatal("first threshold must fire")
	}
	fired, err = repo.RecordThreshold(ctx, b, 50, b.Period, "80.00", "100.00")
	if err != nil {
		t.Fatalf("record second: %v", err)
	}
	if fired {
		t.Fatal("second threshold for the same (budget, threshold, period) must NOT fire")
	}
	// Limiar diferente dispara: a chave é por limiar.
	fired, err = repo.RecordThreshold(ctx, b, 80, b.Period, "80.00", "100.00")
	if err != nil {
		t.Fatalf("record 80: %v", err)
	}
	if !fired {
		t.Fatal("a different threshold must fire")
	}
}

func TestFinanceSumSpentByPeriod(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewFinanceRepository(pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM finance_transactions WHERE user_id = 'fin-user-sum'`)
	})

	// Duas despesas no mesmo mês e uma de outro mês que NÃO pode entrar na soma.
	inMonth := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	otherMonth := time.Date(2026, 9, 4, 12, 0, 0, 0, time.UTC)
	mk := func(id, amount string, when time.Time) domainfinance.Transaction {
		tx := financeTx(t, id, "fin-user-sum", "acct", domainfinance.TypeExpense, amount, "Transporte")
		tx.OccurredAt = when
		return tx
	}
	for _, tx := range []domainfinance.Transaction{
		mk("44444444-4444-4444-4444-444444444444", "10.00", inMonth),
		mk("55555555-5555-5555-5555-555555555555", "5.50", inMonth),
		mk("66666666-6666-6666-6666-666666666666", "100.00", otherMonth),
	} {
		if _, err := repo.Insert(ctx, tx); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	spent, err := repo.SumSpent(ctx, "fin-user-sum", "Transporte", "2026-10")
	if err != nil {
		t.Fatalf("sum: %v", err)
	}
	if spent != 1550 {
		t.Fatalf("soma de outubro = %d centavos; want 1550 (setembro fora)", spent)
	}
}
