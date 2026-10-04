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
	// O sinal do amount codifica a DIREÇÃO (a mesma convenção da
	// transferência, cujo débito é negado): EXPENSE grava negativo, senão a
	// leitura — que soma SUM(amount) para o net e filtra EXPENSE — devolveria
	// uma despesa SOMANDO ao saldo. A borda manda o valor absoluto; quem
	// aplica decide o sinal.
	signed := amount
	if domainfinance.TransactionType(in.Type) == domainfinance.TypeExpense {
		signed = amount.Neg()
	}
	tx, err := domainfinance.NewTransaction(id.String(), in.UserID, in.AccountID,
		domainfinance.TransactionType(in.Type), signed, in.Category, occurredAt, in.SourceType)
	if err != nil {
		return domainfinance.Transaction{}, nil, err
	}
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
