package finance

import (
	"context"
	"testing"
	"time"

	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/finance"
)

// fakeRepo implementa domainfinance.Repository em memória — o service é o
// objeto do teste; o repositório real é coberto no pacote postgres.
type fakeRepo struct {
	txs        map[string]domainfinance.Transaction
	spentCents int64
	fired      map[string]bool
	budgets    map[string]string // (user|category|period) -> id estável
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		txs:     map[string]domainfinance.Transaction{},
		fired:   map[string]bool{},
		budgets: map[string]string{},
	}
}

func (f *fakeRepo) Insert(_ context.Context, t domainfinance.Transaction) (bool, error) {
	if _, ok := f.txs[t.ID]; ok {
		return false, nil
	}
	f.txs[t.ID] = t
	return true, nil
}
func (f *fakeRepo) FindByID(_ context.Context, id string) (domainfinance.Transaction, error) {
	t, ok := f.txs[id]
	if !ok {
		return domainfinance.Transaction{}, domainfinance.ErrNotFound
	}
	return t, nil
}
func (f *fakeRepo) UpdateCategory(_ context.Context, id, category string) error {
	t, ok := f.txs[id]
	if !ok {
		return domainfinance.ErrNotFound
	}
	t.Category = category
	f.txs[id] = t
	return nil
}
func (f *fakeRepo) InsertTransfer(_ context.Context, debit, credit domainfinance.Transaction) error {
	f.txs[debit.ID] = debit
	f.txs[credit.ID] = credit
	return nil
}
func (f *fakeRepo) UpsertBudget(_ context.Context, b domainfinance.Budget) (string, error) {
	key := b.UserID + "|" + b.Category + "|" + b.Period
	if id, ok := f.budgets[key]; ok {
		return id, nil // id estável, como o ON CONFLICT ... RETURNING do real
	}
	f.budgets[key] = b.ID
	return b.ID, nil
}
func (f *fakeRepo) RecordThreshold(_ context.Context, b domainfinance.Budget, threshold int, period, _, _ string) (bool, error) {
	key := b.ID + ":" + period + ":" + string(rune(threshold))
	if f.fired[key] {
		return false, nil
	}
	f.fired[key] = true
	return true, nil
}
func (f *fakeRepo) SumSpent(_ context.Context, _, _, _ string) (int64, error) {
	return f.spentCents, nil
}
func (f *fakeRepo) UpsertConsent(_ context.Context, _ domainfinance.Consent) error { return nil }
func (f *fakeRepo) UpdateConsentStatus(_ context.Context, _ string, _ domainfinance.ConsentStatus, _ string) error {
	return nil
}
func (f *fakeRepo) UpsertOFAccount(_ context.Context, _ domainfinance.OFAccount) error { return nil }

// O import do Open Finance tem id DETERMINÍSTICO por (source, external_id):
// reimportar o mesmo extrato (com id de comando novo) é no-op, não duplicata.
func TestOpenFinanceTransactionIDIsDeterministic(t *testing.T) {
	s := NewService(newFakeRepo())
	in := RegisterTransactionInput{
		UserID: "u", AccountID: "acct", Type: "EXPENSE", Amount: "45.00", Currency: "BRL",
		Category: "Alimentação", OccurredAt: "2026-10-04T12:00:00+00:00",
		SourceType: "OPEN_FINANCE_SYNC", ExternalID: "polp-tx-1",
	}
	tx1, _, err := s.RegisterTransaction(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	tx2, _, err := s.RegisterTransaction(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if tx1.ID != tx2.ID {
		t.Fatalf("o id devia ser determinístico por external_id: %s != %s", tx1.ID, tx2.ID)
	}
}

func TestRegisterTransactionRejectsFloat(t *testing.T) {
	s := NewService(newFakeRepo())
	_, _, err := s.RegisterTransaction(context.Background(), RegisterTransactionInput{
		UserID: "u", AccountID: "a", Type: "EXPENSE", Amount: "45.0.0", Currency: "BRL",
		OccurredAt: "2026-10-04T12:00:00+00:00",
	})
	if err == nil {
		t.Fatal("valor malformado devia falhar antes do banco")
	}
}

func TestRegisterTransactionRequiresTZAware(t *testing.T) {
	s := NewService(newFakeRepo())
	_, _, err := s.RegisterTransaction(context.Background(), RegisterTransactionInput{
		UserID: "u", AccountID: "a", Type: "EXPENSE", Amount: "45.00", Currency: "BRL",
		OccurredAt: "2026-10-04T12:00:00", // sem fuso
	})
	if err == nil {
		t.Fatal("occurred_at sem fuso devia falhar")
	}
}

// O sinal do amount codifica a direção: EXPENSE grava NEGATIVO, senão o net
// (SUM(amount)) somaria a despesa ao saldo. Este é o bug que o teste ponta a
// ponta revelou: a leitura devolvia expense +45 e net +45.
func TestRegisterTransactionSignsExpenseNegative(t *testing.T) {
	repo := newFakeRepo()
	s := NewService(repo)
	tx, _, err := s.RegisterTransaction(context.Background(), RegisterTransactionInput{
		UserID: "u", AccountID: "a", Type: "EXPENSE", Amount: "45.00", Currency: "BRL",
		Category: "Alimentação", OccurredAt: "2026-10-04T12:00:00+00:00",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := tx.Amount.Decimal(); got != "-45.00" {
		t.Fatalf("EXPENSE deveria gravar -45.00 (sinal = direção); veio %s", got)
	}
	if _, ok := repo.txs[tx.ID]; !ok {
		t.Fatal("transação devia ter sido persistida")
	}
}

func TestRegisterTransactionLeavesIncomePositive(t *testing.T) {
	s := NewService(newFakeRepo())
	tx, _, err := s.RegisterTransaction(context.Background(), RegisterTransactionInput{
		UserID: "u", AccountID: "a", Type: "INCOME", Amount: "3500.00", Currency: "BRL",
		Category: "Renda Extra", OccurredAt: "2026-10-04T12:00:00+00:00",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := tx.Amount.Decimal(); got != "3500.00" {
		t.Fatalf("INCOME deveria permanecer positivo; veio %s", got)
	}
}

func TestTransferRejectsSameAccount(t *testing.T) {
	s := NewService(newFakeRepo())
	_, _, err := s.Transfer(context.Background(), TransferBetweenAccountsInput{
		UserID: "u", FromAccountID: "x", ToAccountID: "x", Amount: "10.00", Currency: "BRL",
		OccurredAt: "2026-10-04T12:00:00+00:00",
	})
	if err == nil {
		t.Fatal("transferência para a mesma conta devia falhar")
	}
}

func TestSetCategoryBudgetFiresEachThresholdOnce(t *testing.T) {
	repo := newFakeRepo()
	repo.spentCents = 8000 // R$ 80,00 de um limite de R$ 100,00
	s := NewService(repo)
	in := SetCategoryBudgetInput{UserID: "u", Category: "Alimentação", Limit: "100.00", Currency: "BRL", Period: "2026-10"}

	_, events, err := s.SetCategoryBudget(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	// 80,00 cruza 50 e 80 -> dois eventos.
	if len(events) != 2 {
		t.Fatalf("esperava 2 eventos (50 e 80), veio %d", len(events))
	}
	// A segunda chamada NÃO redispara os mesmos limiares (§3.4 nº5).
	_, events2, err := s.SetCategoryBudget(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	if len(events2) != 0 {
		t.Fatalf("a segunda avaliação não pode redisparar, veio %d", len(events2))
	}
}

func TestServiceIDIsUUIDv7(t *testing.T) {
	s := NewService(newFakeRepo())
	tx, _, err := s.RegisterTransaction(context.Background(), RegisterTransactionInput{
		UserID: "u", AccountID: "a", Type: "EXPENSE", Amount: "45.00", Currency: "BRL",
		OccurredAt: time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	// UUIDv7: o primeiro nibble do 3º grupo é '7'.
	if len(tx.ID) != 36 || tx.ID[14] != '7' {
		t.Fatalf("id não parece UUIDv7: %s", tx.ID)
	}
}
