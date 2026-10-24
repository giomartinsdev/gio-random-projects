package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

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

// Open Finance: o import do extrato é idempotente por (source, external_id) —
// reprocessar o mesmo lote não duplica a transação (§10 da spec).
func TestFinanceOpenFinanceImportIsIdempotentByExternalID(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewFinanceRepository(pool)
	user := "fin-user-of"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM finance_transactions WHERE user_id = $1`, user)
		_, _ = pool.Exec(ctx, `DELETE FROM finance_of_accounts WHERE user_id = $1`, user)
		_, _ = pool.Exec(ctx, `DELETE FROM finance_of_consents WHERE user_id = $1`, user)
	})

	// Consent + conta (upsert idempotente).
	consent, err := domainfinance.NewConsent("11111111-1111-1111-1111-111111111111",
		"polp-consent-1", user, "inst-itau", "Itaú", domainfinance.ConsentAuthorised, "SUCCESS", []string{"ACCOUNT"}, "", time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.UpsertConsent(ctx, consent); err != nil {
		t.Fatalf("upsert consent: %v", err)
	}
	// Reprocessar com status mudado: atualiza, não duplica.
	consent.Status = domainfinance.ConsentExpired
	if err := repo.UpsertConsent(ctx, consent); err != nil {
		t.Fatalf("re-upsert consent: %v", err)
	}
	var consents int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM finance_of_consents WHERE user_id=$1`, user).Scan(&consents)
	if consents != 1 {
		t.Fatalf("consents = %d; want 1 (idempotente)", consents)
	}

	acct, err := domainfinance.NewOFAccount("22222222-2222-2222-2222-222222222222",
		"polp-acct-1", "polp-consent-1", user, "Itaú · Corrente", "CONTA_DEPOSITO_A_VISTA", "BRL", "1500.00", time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.UpsertOFAccount(ctx, acct); err != nil {
		t.Fatalf("upsert account: %v", err)
	}

	// Duas transações do banco; importar de novo não duplica.
	when := time.Date(2026, 10, 4, 12, 0, 0, 0, time.UTC)
	mk := func(id, external, amount string) domainfinance.Transaction {
		tx, err := domainfinance.NewTransaction(id, user, "polp-acct-1", domainfinance.TypeExpense,
			financeMoney(t, amount), "Alimentação", when, "OPEN_FINANCE_SYNC")
		if err != nil {
			t.Fatal(err)
		}
		tx.ExternalID = external
		tx.OFAccountID = "22222222-2222-2222-2222-222222222222"
		tx.Counterparty = "Padaria"
		tx.ExternalCategory = "FOOD_AND_DRINK"
		return tx
	}
	txA := mk("33333333-3333-3333-3333-333333333333", "polp-tx-a", "-45.00")
	if _, err := repo.Insert(ctx, txA); err != nil {
		t.Fatalf("insert A: %v", err)
	}
	// Reimportar a MESMA transação não duplica (uma linha), e ATUALIZA o
	// enriquecimento — o provedor melhora categoria/lugar depois, e a nossa
	// correção de mapeamento precisa alcançar o que já foi importado.
	txA.Category = "Transporte"
	txA.Counterparty = "Uber"
	if _, err := repo.Insert(ctx, txA); err != nil {
		t.Fatalf("reinsert A: %v", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM finance_transactions WHERE user_id=$1 AND source='OPEN_FINANCE_SYNC'`, user).Scan(&n)
	if n != 1 {
		t.Fatalf("transações OF = %d; want 1 (não duplica)", n)
	}
	got, err := repo.FindByID(ctx, txA.ID)
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if got.Category != "Transporte" || got.Counterparty != "Uber" {
		t.Fatalf("re-sync devia atualizar categoria/lugar; veio %q / %q", got.Category, got.Counterparty)
	}
}

func TestFinanceInvestmentUpsertByPrimaryKeyExternal(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	r := NewFinanceRepository(pool)
	{
		id1 := uuid.Must(uuid.NewV7())
		id2 := uuid.Must(uuid.NewV7())
		inv, err := domainfinance.NewInvestment(id1.String(), "u", "consent", "polp-1",
			"BTG Pactual", "CDB", "CDB pós", domainfinance.Money{Cents: 100000, Currency: "BRL"},
			domainfinance.Money{Cents: 112550, Currency: "BRL"}, "11.25", time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if err := r.UpsertInvestment(context.Background(), inv); err != nil {
			t.Fatal(err)
		}
		// reimport com id novo e gross maior: upsert por polp_invest_id
		inv2, err := domainfinance.NewInvestment(id2.String(), "u", "consent", "polp-1",
			"BTG Pactual", "CDB", "CDB pós", domainfinance.Money{Cents: 100000, Currency: "BRL"},
			domainfinance.Money{Cents: 118000, Currency: "BRL"}, "11.80", time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if err := r.UpsertInvestment(context.Background(), inv2); err != nil {
			t.Fatal(err)
		}
		var gross string
		if err := pool.QueryRow(ctx,
			`SELECT gross_amount::text FROM finance_investments WHERE polp_invest_id = 'polp-1'`,
		).Scan(&gross); err != nil {
			t.Fatal(err)
		}
		if gross != "1180.00" {
			t.Fatalf("gross atualizado, veio %s", gross)
		}
	}
}
