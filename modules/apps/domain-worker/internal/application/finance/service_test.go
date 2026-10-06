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
	invests    map[string]domainfinance.Investment
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		txs:     map[string]domainfinance.Transaction{},
		fired:   map[string]bool{},
		budgets: map[string]string{},
		invests: map[string]domainfinance.Investment{},
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
func (f *fakeRepo) RemoveConsent(_ context.Context, _ string) error                  { return nil }
func (f *fakeRepo) UpsertNotification(_ context.Context, _ domainfinance.Notification) error { return nil }
func (f *fakeRepo) DeleteNotification(_ context.Context, _, _ string) error          { return nil }
func (f *fakeRepo) UpdateTransaction(_ context.Context, t domainfinance.Transaction) error {
	if _, ok := f.txs[t.ID]; !ok {
		return domainfinance.ErrNotFound
	}
	f.txs[t.ID] = t
	return nil
}
func (f *fakeRepo) RemoveTransaction(_ context.Context, id, userID string) (bool, error) {
	t, ok := f.txs[id]
	if !ok || t.UserID != userID {
		return false, nil
	}
	delete(f.txs, id)
	return true, nil
}
func (f *fakeRepo) UpsertInvestment(_ context.Context, i domainfinance.Investment) error {
	f.invests[i.PolpInvestID] = i
	return nil
}
func (f *fakeRepo) UpsertCreditCard(context.Context, domainfinance.CreditCard) error { return nil }
func (f *fakeRepo) UpsertBill(context.Context, domainfinance.Bill) error             { return nil }
func (f *fakeRepo) UpsertLoan(context.Context, domainfinance.CreditContract) error   { return nil }
func (f *fakeRepo) UpsertFinancing(context.Context, domainfinance.CreditContract) error {
	return nil
}
func (f *fakeRepo) UpsertExchange(context.Context, domainfinance.Exchange) error { return nil }
func (f *fakeRepo) UpsertInvestmentTransaction(context.Context, domainfinance.InvestmentTransaction) error {
	return nil
}
func (f *fakeRepo) UpsertOFRaw(context.Context, domainfinance.OFRaw) error { return nil }
func (f *fakeRepo) SetTransactionActive(_ context.Context, id, userID string, active bool) error {
	t, ok := f.txs[id]
	if !ok || t.UserID != userID {
		return domainfinance.ErrNotFound
	}
	t.Inactive = !active
	f.txs[id] = t
	return nil
}

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

func txForOwner(t *testing.T, s *Service) domainfinance.Transaction {
	t.Helper()
	tx, _, err := s.RegisterTransaction(context.Background(), RegisterTransactionInput{
		UserID: "u", AccountID: "acct", Type: "EXPENSE", Amount: "45.00", Currency: "BRL",
		Category: "Alimentação", OccurredAt: "2026-10-04T12:00:00+00:00",
		SourceType: "WEB_MANUAL",
	})
	if err != nil {
		t.Fatal(err)
	}
	return tx
}

// Correção do dono: patch parcial muda só o que veio; o evento carrega o novo estado.
func TestUpdateTransactionPartialPatch(t *testing.T) {
	s := NewService(newFakeRepo())
	tx := txForOwner(t, s)
	evt, err := s.UpdateTransaction(context.Background(), UpdateTransactionInput{
		UserID: "u", TransactionID: tx.ID, Category: "Mercado",
	})
	if err != nil {
		t.Fatal(err)
	}
	upd, ok := evt.(domainfinance.TransactionUpdated)
	if !ok {
		t.Fatalf("evento devia ser TransactionUpdated, veio %T", evt)
	}
	if upd.Category != "Mercado" {
		t.Fatalf("categoria nova esperada, veio %q", upd.Category)
	}
	after, _ := s.repo.FindByID(context.Background(), tx.ID)
	if after.Category != "Mercado" || after.Amount.Cents != tx.Amount.Cents {
		t.Fatalf("patch parcial devia preservar amount: %+v", after)
	}
}

// Editar sem mudança efetiva: no-op, sem evento (não metralha o WhatsApp).
func TestUpdateTransactionNoChangeIsNoEvent(t *testing.T) {
	s := NewService(newFakeRepo())
	tx := txForOwner(t, s)
	evt, err := s.UpdateTransaction(context.Background(), UpdateTransactionInput{
		UserID: "u", TransactionID: tx.ID, Category: "Alimentação",
	})
	if err != nil {
		t.Fatal(err)
	}
	if evt != nil {
		t.Fatalf("sem mudança não devia ter evento, veio %T", evt)
	}
}

// Posse: outro user não edita nem remove (§3.4 nº3 aplicado à correção).
func TestUpdateAndRemoveRequireOwner(t *testing.T) {
	s := NewService(newFakeRepo())
	tx := txForOwner(t, s)
	if _, err := s.UpdateTransaction(context.Background(), UpdateTransactionInput{
		UserID: "intruso", TransactionID: tx.ID, Category: "X",
	}); err != domainfinance.ErrNotTransactionOwner {
		t.Fatalf("update de outro user devia ser ErrNotTransactionOwner, veio %v", err)
	}
	if _, err := s.RemoveTransaction(context.Background(), RemoveTransactionInput{
		UserID: "intruso", TransactionID: tx.ID,
	}); err != domainfinance.ErrNotTransactionOwner {
		t.Fatalf("remove de outro user devia ser ErrNotTransactionOwner, veio %v", err)
	}
}

// Remoção do dono: some do repo e o evento carrega o id.
func TestRemoveTransactionByOwner(t *testing.T) {
	s := NewService(newFakeRepo())
	tx := txForOwner(t, s)
	evt, err := s.RemoveTransaction(context.Background(), RemoveTransactionInput{
		UserID: "u", TransactionID: tx.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	rem, ok := evt.(domainfinance.TransactionRemoved)
	if !ok || rem.TransactionID != tx.ID {
		t.Fatalf("evento devia ser TransactionRemoved com o id, veio %T", evt)
	}
	if _, err := s.repo.FindByID(context.Background(), tx.ID); err != domainfinance.ErrNotFound {
		t.Fatalf("removido devia ser not-found, veio %v", err)
	}
}

// Troca de tipo: EXPENSE grava negativo, trocar para INCOME reverte o sinal.
func TestUpdateTransactionTypeFlipsSign(t *testing.T) {
	s := NewService(newFakeRepo())
	tx := txForOwner(t, s) // EXPENSE 45.00 -> armazenado -45
	evt, err := s.UpdateTransaction(context.Background(), UpdateTransactionInput{
		UserID: "u", TransactionID: tx.ID, TransactionType: "INCOME",
	})
	if err != nil {
		t.Fatal(err)
	}
	upd := evt.(domainfinance.TransactionUpdated)
	if upd.Amount != "45.00" {
		t.Fatalf("INCOME devia ficar positivo (45.00), veio %s", upd.Amount)
	}
}

// Flag de movimentação própria: inativa sai das métricas; pedir o estado
// atual é no-op; posse obrigatória.
func TestSetTransactionActive(t *testing.T) {
	s := NewService(newFakeRepo())
	tx := txForOwner(t, s)
	// marca inativa (movimentação BTG -> MP)
	evt, err := s.SetTransactionActive(context.Background(), SetTransactionActiveInput{
		UserID: "u", TransactionID: tx.ID, Active: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	chg, ok := evt.(domainfinance.TransactionActivityChanged)
	if !ok || chg.Active {
		t.Fatalf("evento devia ser activityChanged(active=false), veio %T %+v", evt, chg)
	}
	// pedir o mesmo estado de novo = no-op
	if _, err := s.SetTransactionActive(context.Background(), SetTransactionActiveInput{
		UserID: "u", TransactionID: tx.ID, Active: false,
	}); err != domainfinance.ErrNoChange {
		t.Fatalf("re-marcar devia ser ErrNoChange, veio %v", err)
	}
	// intruso
	if _, err := s.SetTransactionActive(context.Background(), SetTransactionActiveInput{
		UserID: "intruso", TransactionID: tx.ID, Active: true,
	}); err != domainfinance.ErrNotTransactionOwner {
		t.Fatalf("flag de outro user devia ser ErrNotTransactionOwner, veio %v", err)
	}
	// reativa
	if _, err := s.SetTransactionActive(context.Background(), SetTransactionActiveInput{
		UserID: "u", TransactionID: tx.ID, Active: true,
	}); err != nil {
		t.Fatal(err)
	}
	after, _ := s.repo.FindByID(context.Background(), tx.ID)
	if !after.IsActive() {
		t.Fatal("reativação devia voltar para active")
	}
}

// Investimento: upsert idempotente por polp_invest_id, rendimento precomputado.
func TestUpsertInvestmentComputesYield(t *testing.T) {
	s := NewService(newFakeRepo())
	in := InvestmentSyncedInput{
		UserID: "u", PolpConsentID: "c1", PolpInvestID: "inv-1",
		InstitutionName: "BTG Pactual", Type: "CDB", Name: "CDB pós 110% CDI",
		Currency: "BRL", InvestedAmount: "10000.00", GrossAmount: "11125.50",
		UpdatedAt: "2026-10-05T12:00:00Z",
	}
	if err := s.UpsertInvestment(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	repo := s.repo.(*fakeRepo)
	yieldCents := repo.invests["inv-1"].GrossAmount.Cents - repo.invests["inv-1"].InvestedAmount.Cents
	if yieldCents != 112550 {
		t.Fatalf("rendimento esperado 1112,55, veio %v", yieldCents)
	}
	if repo.invests["inv-1"].YieldPercent != "11.25" {
		t.Fatalf("yield percent derivado 11.25, veio %q", repo.invests["inv-1"].YieldPercent)
	}
	// reimportar é upsert, não linha nova
	if err := s.UpsertInvestment(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	if len(repo.invests) != 1 {
		t.Fatalf("upsert por external id devia manter 1, veio %d", len(repo.invests))
	}
}

func TestUpsertInvestmentRequiresInstitutionAndAmount(t *testing.T) {
	s := NewService(newFakeRepo())
	if err := s.UpsertInvestment(context.Background(), InvestmentSyncedInput{
		UserID: "u", PolpInvestID: "inv-2", Currency: "BRL",
		InvestedAmount: "10.00", GrossAmount: "11.00",
	}); err != domainfinance.ErrInvestInstitutionRequired {
		t.Fatalf("instituição obrigatória, veio %v", err)
	}
}
