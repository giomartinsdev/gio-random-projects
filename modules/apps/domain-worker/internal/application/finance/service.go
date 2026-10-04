package finance

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	domainfinance "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/finance"
)

// Service é o caso de uso — a única coisa que chama os métodos de escrita do
// repositório, então toda mutação passa pelas invariantes do agregado.
type Service struct {
	repo domainfinance.Repository
	now  func() time.Time
}

func NewService(repo domainfinance.Repository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// RegisterTransaction valida e grava uma transação. O id é um UUIDv7 gerado
// AQUI (é quem aplica que escolhe o id — a ACL/worker nunca mandam id, §4.1).
func (s *Service) RegisterTransaction(ctx context.Context, in RegisterTransactionInput) (domainfinance.Transaction, domainfinance.Event, error) {
	amount, err := domainfinance.ParseMoney(in.Amount, in.Currency)
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	occurredAt, err := parseOccurredAt(in.OccurredAt)
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	// Open Finance: o id é DETERMINÍSTICO a partir de (source, external_id),
	// então reimportar o mesmo extrato é um no-op — não um erro de índice único
	// com um id novo. O import do banco é reprocessável por natureza (o cursor
	// do conector reinicia no boot), então a chave precisa ser estável.
	txID := id.String()
	if in.ExternalID != "" {
		src := in.SourceType
		if src == "" {
			src = "OPEN_FINANCE_SYNC"
		}
		txID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(src+"|"+in.ExternalID)).String()
	}
	// O sinal do amount codifica a DIREÇÃO (a mesma convenção da
	// transferência, cujo débito é negado): EXPENSE grava negativo, senão a
	// leitura — que soma SUM(amount) para o net e filtra EXPENSE — devolveria
	// uma despesa SOMANDO ao saldo. A borda manda o valor absoluto; quem
	// aplica decide o sinal.
	signed := amount
	if domainfinance.TransactionType(in.Type) == domainfinance.TypeExpense {
		signed = amount.Neg()
	}
	tx, err := domainfinance.NewTransaction(txID, in.UserID, in.AccountID,
		domainfinance.TransactionType(in.Type), signed, in.Category, occurredAt, in.SourceType)
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	tx.ExternalID = in.ExternalID
	tx.OFAccountID = in.OFAccountID
	tx.Counterparty = in.Counterparty
	tx.ExternalCategory = in.ExternalCategory
	if _, err := s.repo.Insert(ctx, tx); err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	return tx, domainfinance.TransactionRegistered{
		TransactionID: tx.ID,
		UserID:        tx.UserID,
		AccountID:     tx.AccountID,
		Type:          tx.Type,
		Amount:        tx.Amount.Decimal(),
		Currency:      tx.Amount.Currency,
		Category:      tx.Category,
		OccurredAt:    tx.OccurredAt,
	}, nil
}

func (s *Service) Categorize(ctx context.Context, in CategorizeTransactionInput) (domainfinance.Event, error) {
	if in.TransactionID == "" {
		return nil, fmt.Errorf("%w: transaction_id", domainfinance.ErrTransactionIDRequired)
	}
	existing, err := s.repo.FindByID(ctx, in.TransactionID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateCategory(ctx, in.TransactionID, in.Category); err != nil {
		return nil, err
	}
	return domainfinance.TransactionCategorized{
		TransactionID: in.TransactionID,
		UserID:        existing.UserID,
		Category:      in.Category,
		OccurredAt:    s.now(),
	}, nil
}

// Transfer grava débito+crédito atômicos (§3.4 nº2). Os dois lados recebem
// UUIDv7 distintos; o crédito é o valor com sinal trocado.
func (s *Service) Transfer(ctx context.Context, in TransferBetweenAccountsInput) (domainfinance.Transaction, domainfinance.Event, error) {
	if in.FromAccountID == "" || in.ToAccountID == "" || in.FromAccountID == in.ToAccountID {
		return domainfinance.Transaction{}, nil, domainfinance.ErrTransferNeedsAccounts
	}
	amount, err := domainfinance.ParseMoney(in.Amount, in.Currency)
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	occurredAt, err := parseOccurredAt(in.OccurredAt)
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	debitID, err := uuid.NewV7()
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	creditID, err := uuid.NewV7()
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	debit, err := domainfinance.NewTransaction(debitID.String(), in.UserID, in.FromAccountID,
		domainfinance.TypeTransfer, amount.Neg(), "", occurredAt, "WHATSAPP_MANUAL")
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	credit, err := domainfinance.NewTransaction(creditID.String(), in.UserID, in.ToAccountID,
		domainfinance.TypeTransfer, amount, "", occurredAt, "WHATSAPP_MANUAL")
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	if err := s.repo.InsertTransfer(ctx, debit, credit); err != nil {
		return domainfinance.Transaction{}, nil, err
	}
	return debit, domainfinance.TransferCompleted{
		TransactionID: debit.ID,
		UserID:        in.UserID,
		FromAccountID: in.FromAccountID,
		ToAccountID:   in.ToAccountID,
		Amount:        amount.Decimal(),
		Currency:      amount.Currency,
		OccurredAt:    occurredAt,
	}, nil
}

// SetCategoryBudget faz upsert do orçamento e avalia as réguas: para cada
// limiar cruzado pelo gasto do período, grava o disparo (uma vez) e devolve um
// evento. A lista de eventos é o que o worker conversacional consome para
// avisar (§13) — mais de um se o gasto cruzar várias réguas de uma vez.
func (s *Service) SetCategoryBudget(ctx context.Context, in SetCategoryBudgetInput) (domainfinance.Budget, []domainfinance.Event, error) {
	limit, err := domainfinance.ParseMoney(in.Limit, in.Currency)
	if err != nil {
		return domainfinance.Budget{}, nil, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return domainfinance.Budget{}, nil, err
	}
	b, err := domainfinance.NewBudget(id.String(), in.UserID, in.Category, limit, in.Period)
	if err != nil {
		return domainfinance.Budget{}, nil, err
	}
	// O upsert devolve o id ESTÁVEL: numa segunda avaliação o id da linha
	// existente (não o recém-gerado), senão a chave da régua mudaria e o
	// "uma vez por limiar" não valeria.
	stableID, err := s.repo.UpsertBudget(ctx, b)
	if err != nil {
		return domainfinance.Budget{}, nil, err
	}
	b.ID = stableID

	spentCents, err := s.repo.SumSpent(ctx, b.UserID, b.Category, b.Period)
	if err != nil {
		return domainfinance.Budget{}, nil, err
	}
	events := []domainfinance.Event{}
	for _, threshold := range b.CrossedThresholds(spentCents) {
		spentMoney := domainfinance.Money{Cents: spentCents, Currency: b.Limit.Currency}
		fired, err := s.repo.RecordThreshold(ctx, b, threshold, b.Period, spentMoney.Decimal(), b.Limit.Decimal())
		if err != nil {
			return domainfinance.Budget{}, nil, err
		}
		if !fired {
			continue // já disparou este limiar neste período — uma vez (§3.4 nº5)
		}
		events = append(events, domainfinance.BudgetThresholdReached{
			BudgetID:    b.ID,
			UserID:      b.UserID,
			Category:    b.Category,
			Threshold:   threshold,
			Period:      b.Period,
			SpentAmount: spentMoney.Decimal(),
			LimitAmount: b.Limit.Decimal(),
			Currency:    b.Limit.Currency,
			OccurredAt:  s.now(),
		})
	}
	return b, events, nil
}

// parseOccurredAt exige um instante tz-aware em RFC3339. A borda (finance-api)
// já recusa payload sem fuso; aqui é uma segunda barreira, porque um comando
// pode chegar ao barramento por outro produtor um dia.
func parseOccurredAt(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, domainfinance.ErrOccurredAtRequired
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %q", domainfinance.ErrOccurredAtRequired, raw)
	}
	return t.UTC(), nil
}

// --------------------------------------------------------------- Open Finance

// UpsertConsent grava o consentimento (idempotente por polp_consent_id).
func (s *Service) UpsertConsent(ctx context.Context, in ConsentCreatedInput) (domainfinance.Consent, domainfinance.Event, error) {
	if in.UserID == "" {
		return domainfinance.Consent{}, nil, domainfinance.ErrUserIDRequired
	}
	if in.PolpConsentID == "" {
		return domainfinance.Consent{}, nil, domainfinance.ErrConsentIDRequired
	}
	id, err := uuid.NewV7()
	if err != nil {
		return domainfinance.Consent{}, nil, err
	}
	var urlExpires time.Time
	if in.URLExpiresAt != "" {
		if t, perr := time.Parse(time.RFC3339, in.URLExpiresAt); perr == nil {
			urlExpires = t.UTC()
		}
	}
	c, err := domainfinance.NewConsent(id.String(), in.PolpConsentID, in.UserID, in.InstitutionID,
		in.InstitutionName, domainfinance.ConsentStatus(in.Status), in.ExecutionStatus,
		in.Products, in.URLToAuthenticate, urlExpires)
	if err != nil {
		return domainfinance.Consent{}, nil, err
	}
	if err := s.repo.UpsertConsent(ctx, c); err != nil {
		return domainfinance.Consent{}, nil, err
	}
	return c, domainfinance.ConsentUpdated{
		PolpConsentID:   c.PolpConsentID,
		UserID:          c.UserID,
		InstitutionName: c.InstitutionName,
		Status:          c.Status,
		ExecutionStatus: c.ExecutionStatus,
		OccurredAt:      s.now(),
	}, nil
}

// UpdateConsentStatus muda o estado de uma conexão existente.
func (s *Service) UpdateConsentStatus(ctx context.Context, in ConsentUpdatedInput) (domainfinance.Event, error) {
	if in.PolpConsentID == "" {
		return nil, domainfinance.ErrConsentIDRequired
	}
	if err := s.repo.UpdateConsentStatus(ctx, in.PolpConsentID, domainfinance.ConsentStatus(in.Status), in.ExecutionStatus); err != nil {
		return nil, err
	}
	// O evento carrega o que o aviso precisa; o user_id/institution saem da
	// leitura do consentimento só quando notificamos — para o evento bastam os
	// campos que temos do comando.
	return domainfinance.ConsentUpdated{
		PolpConsentID:   in.PolpConsentID,
		Status:          domainfinance.ConsentStatus(in.Status),
		ExecutionStatus: in.ExecutionStatus,
		OccurredAt:      s.now(),
	}, nil
}

// SyncAccount grava/atualiza a conta importada (idempotente por polp_account_id).
// Não gera evento: a conta é dado de apoio; o aviso é da transação.
func (s *Service) SyncAccount(ctx context.Context, in AccountSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	var balanceAt time.Time
	if in.BalanceUpdatedAt != "" {
		if t, perr := time.Parse(time.RFC3339, in.BalanceUpdatedAt); perr == nil {
			balanceAt = t.UTC()
		}
	}
	currency := in.Currency
	if currency == "" {
		currency = "BRL"
	}
	a, err := domainfinance.NewOFAccount(id.String(), in.PolpAccountID, in.PolpConsentID, in.UserID,
		in.Name, in.AccountType, currency, in.BalanceAmount, balanceAt)
	if err != nil {
		return err
	}
	return s.repo.UpsertOFAccount(ctx, a)
}

// RemoveConsent apaga uma conexão revogada (some da lista).
func (s *Service) RemoveConsent(ctx context.Context, polpConsentID string) error {
	if polpConsentID == "" {
		return domainfinance.ErrConsentIDRequired
	}
	return s.repo.RemoveConsent(ctx, polpConsentID)
}
