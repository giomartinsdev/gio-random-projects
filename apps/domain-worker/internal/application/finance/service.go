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
	tx.Description = in.Description
	tx.Historical = in.Historical
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
		SourceType:    tx.Source,
		Historical:    tx.Historical,
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

// UpdateTransaction aplica a correção do dono (payload parcial: campo vazio
// mantém o atual). A posse é verificada ANTES (FindByID + user) para o erro
// certo, e de novo no UPDATE (user_id no WHERE) — segunda barreira sem custo.
func (s *Service) UpdateTransaction(ctx context.Context, in UpdateTransactionInput) (domainfinance.Event, error) {
	if in.UserID == "" {
		return nil, fmt.Errorf("%w: user_id", domainfinance.ErrUserIDRequired)
	}
	if in.TransactionID == "" {
		return nil, fmt.Errorf("%w: transaction_id", domainfinance.ErrTransactionIDRequired)
	}
	current, err := s.repo.FindByID(ctx, in.TransactionID)
	if err != nil {
		return domainfinance.TransactionRemoved{}, err
	}
	if current.UserID != in.UserID {
		return domainfinance.TransactionRemoved{}, domainfinance.ErrNotTransactionOwner
	}

	next := current
	changed := false

	if in.Category != "" && in.Category != current.Category {
		next.Category = in.Category
		changed = true
	}
	if in.Counterparty != "" && in.Counterparty != current.Counterparty {
		next.Counterparty = in.Counterparty
		changed = true
	}
	if in.Description != "" && in.Description != current.Description {
		next.Description = in.Description
		changed = true
	}
	if in.OccurredAt != "" {
		t, err := parseOccurredAt(in.OccurredAt)
		if err != nil {
			return domainfinance.TransactionRemoved{}, err
		}
		if !t.Equal(current.OccurredAt) {
			next.OccurredAt = t
			changed = true
		}
	}
	if in.Amount != "" {
		if in.TransactionType != "" && in.TransactionType != string(current.Type) {
			tt := domainfinance.TransactionType(in.TransactionType)
			if tt != domainfinance.TypeIncome && tt != domainfinance.TypeExpense && tt != domainfinance.TypeTransfer {
				return domainfinance.TransactionRemoved{}, domainfinance.ErrTypeInvalid
			}
			next.Type = tt
		}
		currency := in.Currency
		if currency == "" {
			currency = current.Amount.Currency
		}
		amount, err := domainfinance.ParseMoney(in.Amount, currency)
		if err != nil {
			return domainfinance.TransactionRemoved{}, err
		}
		// Mesma convenção do register: EXPENSE grava negativo; INCOME/TRANSFER
		// positivo. A borda manda o valor absoluto; quem aplica decide o sinal.
		if next.Type == domainfinance.TypeExpense {
			amount = amount.Neg()
		}
		if amount.Cents != current.Amount.Cents || next.Type != current.Type {
			next.Amount = amount
			changed = true
		}
	} else if in.TransactionType != "" && in.TransactionType != string(current.Type) {
		// troca de tipo sem amount: o sinal precisa acompanhar o novo tipo
		tt := domainfinance.TransactionType(in.TransactionType)
		if tt != domainfinance.TypeIncome && tt != domainfinance.TypeExpense && tt != domainfinance.TypeTransfer {
			return domainfinance.TransactionRemoved{}, domainfinance.ErrTypeInvalid
		}
		next.Type = tt
		if tt == domainfinance.TypeExpense && current.Amount.Cents > 0 {
			next.Amount = current.Amount.Neg()
		} else if tt != domainfinance.TypeExpense && current.Amount.Cents < 0 {
			next.Amount = current.Amount.Neg()
		}
		changed = true
	}

	if !changed {
		// nada mudou: no-op honesto, sem evento (não metralha o whatsapp)
		return nil, nil
	}
	if err := s.repo.UpdateTransaction(ctx, next); err != nil {
		return domainfinance.TransactionRemoved{}, err
	}
	return domainfinance.TransactionUpdated{
		TransactionID: next.ID,
		UserID:        next.UserID,
		Type:          next.Type,
		Amount:        next.Amount.Decimal(),
		Currency:      next.Amount.Currency,
		Category:      next.Category,
		OccurredAt:    next.OccurredAt,
	}, nil
}

// RemoveTransaction apaga o lançamento do dono. Posse dupla: leitura antes
// (erro certo) e user_id no DELETE (segunda barreira). `false` do repo é
// not-found para ambos os casos (não vaza existência).
func (s *Service) RemoveTransaction(ctx context.Context, in RemoveTransactionInput) (domainfinance.Event, error) {
	if in.UserID == "" {
		return nil, fmt.Errorf("%w: user_id", domainfinance.ErrUserIDRequired)
	}
	if in.TransactionID == "" {
		return nil, fmt.Errorf("%w: transaction_id", domainfinance.ErrTransactionIDRequired)
	}
	current, err := s.repo.FindByID(ctx, in.TransactionID)
	if err != nil {
		return nil, err
	}
	if current.UserID != in.UserID {
		return nil, domainfinance.ErrNotTransactionOwner
	}
	removed, err := s.repo.RemoveTransaction(ctx, in.TransactionID, in.UserID)
	if err != nil {
		return nil, err
	}
	if !removed {
		return nil, domainfinance.ErrNotFound
	}
	return domainfinance.TransactionRemoved{
		TransactionID: in.TransactionID,
		UserID:        in.UserID,
		OccurredAt:    s.now(),
	}, nil
}

// SetTransactionActive alterna a flag de movimentação entre contas próprias.
// Inativo = fora de receitas/despesas/net/categorias/cashflow, MAS dentro do
// saldo da conta (o repo de saldo soma tudo). Pedir o estado atual = no-op.
func (s *Service) SetTransactionActive(ctx context.Context, in SetTransactionActiveInput) (domainfinance.Event, error) {
	if in.UserID == "" {
		return nil, fmt.Errorf("%w: user_id", domainfinance.ErrUserIDRequired)
	}
	if in.TransactionID == "" {
		return nil, fmt.Errorf("%w: transaction_id", domainfinance.ErrTransactionIDRequired)
	}
	current, err := s.repo.FindByID(ctx, in.TransactionID)
	if err != nil {
		return nil, err
	}
	if current.UserID != in.UserID {
		return nil, domainfinance.ErrNotTransactionOwner
	}
	if current.IsActive() == in.Active {
		return nil, domainfinance.ErrNoChange
	}
	if err := s.repo.SetTransactionActive(ctx, in.TransactionID, in.UserID, in.Active); err != nil {
		return nil, err
	}
	return domainfinance.TransactionActivityChanged{
		TransactionID: in.TransactionID,
		UserID:        in.UserID,
		Active:        in.Active,
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

// ------------------------------------------------------------- Notificações

func (s *Service) SetNotification(ctx context.Context, in NotificationInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	id := in.ID
	if id == "" {
		gen, err := uuid.NewV7()
		if err != nil {
			return err
		}
		id = gen.String()
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	n, err := domainfinance.NewNotification(id, in.UserID, in.Kind, in.Category, in.Threshold, in.Channel, enabled)
	if err != nil {
		return err
	}
	return s.repo.UpsertNotification(ctx, n)
}

func (s *Service) DeleteNotification(ctx context.Context, in NotificationDeleteInput) error {
	if in.NotificationID == "" {
		return domainfinance.ErrNotificationIDRequired
	}
	return s.repo.DeleteNotification(ctx, in.UserID, in.NotificationID)
}

// ---------------------------------------------------------------- Investimentos

// UpsertInvestment grava/atualiza a posição importada das 5 famílias do
// Celcoin/Polp (idempotente por polp_invest_id). Investido vazio (ações/
// fundos) = desconhecido (Cents 0) — a UI mostra "—", o yield percentual de
// custo é derivado somente quando o investido existe.
func (s *Service) UpsertInvestment(ctx context.Context, in InvestmentSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.PolpInvestID == "" {
		return domainfinance.ErrInvestExternalIDRequired
	}
	institution := in.InstitutionName
	if institution == "" {
		return domainfinance.ErrInvestInstitutionRequired
	}
	gross, err := domainfinance.ParseMoney(in.GrossAmount, in.Currency)
	if err != nil {
		return err
	}
	net, err := domainfinance.ParseMoney(orDefault(in.NetAmount, in.GrossAmount), in.Currency)
	if err != nil {
		return err
	}
	// Investido (custo) DESCONHECIDO quando o conector manda vazio (ações/fundos
	// não entregam preço de compra). NÃO cair para o bruto: isso faria
	// investido == bruto e o rendimento apareceria sempre 0. Zero = desconhecido;
	// a leitura devolve rendimento vazio nesse caso.
	invested := domainfinance.Money{Cents: 0, Currency: in.Currency}
	if in.InvestedAmount != "" {
		invested, err = domainfinance.ParseMoney(in.InvestedAmount, in.Currency)
		if err != nil {
			return err
		}
	}
	tax, err := domainfinance.ParseMoney(orDefault(in.IncomeTax, "0.00"), in.Currency)
	if err != nil {
		return err
	}
	iof, err := domainfinance.ParseMoney(orDefault(in.IOF, "0.00"), in.Currency)
	if err != nil {
		return err
	}
	pu, err := domainfinance.ParseMoney(orDefault(in.PurchaseUnit, "0.00"), in.Currency)
	if err != nil {
		return err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	var updatedAt time.Time
	if in.UpdatedAt != "" {
		if t, perr := time.Parse(time.RFC3339, in.UpdatedAt); perr == nil {
			updatedAt = t.UTC()
		}
	}
	i := domainfinance.Investment{
		ID: id.String(), UserID: in.UserID, PolpConsentID: in.PolpConsentID,
		PolpInvestID: in.PolpInvestID, Family: in.Family, InstitutionName: institution,
		Type: in.Type, Name: in.Name, Currency: in.Currency,
		InvestedAmount: invested, GrossAmount: gross, NetAmount: net,
		IncomeTax: tax, IOF: iof,
		Quantity: in.Quantity, PurchaseUnit: pu,
		Indexer: in.Indexer, IndexerRate: in.IndexerRate, YieldLabel: in.YieldLabel,
		DueDate: in.DueDate, IsinCode: in.IsinCode, Ticker: in.Ticker,
		UpdatedAt: updatedAt,
	}
	if invested.Cents > 0 {
		i.YieldPercent = fmt.Sprintf("%.2f", (float64(gross.Cents-invested.Cents)/float64(invested.Cents))*100)
	}
	return s.repo.UpsertInvestment(ctx, i)
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

// ------------------------------------------------- Open Finance "pegar tudo"

func (s *Service) parseUpdatedAt(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.UTC()
	}
	return time.Time{}
}

func (s *Service) moneyOrZero(raw, currency string) (domainfinance.Money, error) {
	return domainfinance.ParseMoney(orDefault(raw, "0.00"), orDefault(currency, "BRL"))
}

func (s *Service) UpsertCreditCard(ctx context.Context, in CreditCardSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.PolpCardID == "" {
		return domainfinance.ErrCardExternalIDRequired
	}
	limit, err := s.moneyOrZero(in.CreditLimit, in.Currency)
	if err != nil {
		return err
	}
	available, err := s.moneyOrZero(in.AvailableLimit, in.Currency)
	if err != nil {
		return err
	}
	balance, err := s.moneyOrZero(in.Balance, in.Currency)
	if err != nil {
		return err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return s.repo.UpsertCreditCard(ctx, domainfinance.CreditCard{
		ID: id.String(), UserID: in.UserID, PolpConsentID: in.PolpConsentID, PolpCardID: in.PolpCardID,
		Name: in.Name, Brand: in.Brand, Last4: in.Last4,
		CreditLimit: limit, AvailableLimit: available, Balance: balance,
		Currency: orDefault(in.Currency, "BRL"), DueDay: in.DueDay, UpdatedAt: s.parseUpdatedAt(in.UpdatedAt),
	})
}

func (s *Service) UpsertBill(ctx context.Context, in BillSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.PolpBillID == "" {
		return domainfinance.ErrBillExternalIDRequired
	}
	total, err := s.moneyOrZero(in.TotalAmount, in.Currency)
	if err != nil {
		return err
	}
	minimum, err := s.moneyOrZero(in.MinimumAmount, in.Currency)
	if err != nil {
		return err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return s.repo.UpsertBill(ctx, domainfinance.Bill{
		ID: id.String(), UserID: in.UserID, PolpConsentID: in.PolpConsentID,
		PolpBillID: in.PolpBillID, PolpCardID: in.PolpCardID,
		DueDate: in.DueDate, CloseDate: in.CloseDate, TotalAmount: total, MinimumAmount: minimum,
		Currency: orDefault(in.Currency, "BRL"), Status: in.Status, UpdatedAt: s.parseUpdatedAt(in.UpdatedAt),
	})
}

func (s *Service) contractFrom(
	id, externalID, userID, consentID, name, itype, contractAmount, outstanding, installment, rate, currency, contractDate, dueDate, total, paid, updatedAt string,
) (domainfinance.CreditContract, error) {
	amount, err := s.moneyOrZero(contractAmount, currency)
	if err != nil {
		return domainfinance.CreditContract{}, err
	}
	out, err := s.moneyOrZero(outstanding, currency)
	if err != nil {
		return domainfinance.CreditContract{}, err
	}
	inst, err := s.moneyOrZero(installment, currency)
	if err != nil {
		return domainfinance.CreditContract{}, err
	}
	return domainfinance.CreditContract{
		ID: id, UserID: userID, PolpConsentID: consentID, ExternalID: externalID,
		Name: name, Type: itype, ContractAmount: amount, OutstandingBalance: out, InstallmentAmount: inst,
		InterestRate: rate, Currency: orDefault(currency, "BRL"), ContractDate: contractDate, DueDate: dueDate,
		TotalInstallments: total, PaidInstallments: paid, UpdatedAt: s.parseUpdatedAt(updatedAt),
	}, nil
}

func (s *Service) UpsertLoan(ctx context.Context, in LoanSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.PolpLoanID == "" {
		return domainfinance.ErrLoanExternalIDRequired
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	c, err := s.contractFrom(id.String(), in.PolpLoanID, in.UserID, in.PolpConsentID,
		in.Name, in.Type, in.ContractAmount, in.OutstandingBalance, in.InstallmentAmount, in.InterestRate,
		in.Currency, in.ContractDate, in.DueDate, in.TotalInstallments, in.PaidInstallments, in.UpdatedAt)
	if err != nil {
		return err
	}
	return s.repo.UpsertLoan(ctx, c)
}

func (s *Service) UpsertFinancing(ctx context.Context, in FinancingSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.PolpFinancingID == "" {
		return domainfinance.ErrFinancingExternalIDRequired
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	c, err := s.contractFrom(id.String(), in.PolpFinancingID, in.UserID, in.PolpConsentID,
		in.Name, in.Type, in.ContractAmount, in.OutstandingBalance, in.InstallmentAmount, in.InterestRate,
		in.Currency, in.ContractDate, in.DueDate, in.TotalInstallments, in.PaidInstallments, in.UpdatedAt)
	if err != nil {
		return err
	}
	return s.repo.UpsertFinancing(ctx, c)
}

func (s *Service) UpsertExchange(ctx context.Context, in ExchangeSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.PolpExchangeID == "" {
		return domainfinance.ErrExchangeExternalIDRequired
	}
	amount, err := s.moneyOrZero(in.Amount, in.Currency)
	if err != nil {
		return err
	}
	var occurred time.Time
	if in.OccurredAt != "" {
		if t, perr := time.Parse(time.RFC3339, in.OccurredAt); perr == nil {
			occurred = t.UTC()
		}
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return s.repo.UpsertExchange(ctx, domainfinance.Exchange{
		ID: id.String(), UserID: in.UserID, PolpConsentID: in.PolpConsentID, PolpExchangeID: in.PolpExchangeID,
		Type: in.Type, Amount: amount, Currency: orDefault(in.Currency, "BRL"),
		TargetCurrency: in.TargetCurrency, ExchangeRate: in.ExchangeRate, OccurredAt: occurred,
		UpdatedAt: s.parseUpdatedAt(in.UpdatedAt),
	})
}

func (s *Service) UpsertInvestmentTransaction(ctx context.Context, in InvestmentTransactionSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.PolpTxID == "" {
		return domainfinance.ErrInvestTxExternalIDRequired
	}
	amount, err := s.moneyOrZero(in.Amount, in.Currency)
	if err != nil {
		return err
	}
	var occurred time.Time
	if in.OccurredAt != "" {
		if t, perr := time.Parse(time.RFC3339, in.OccurredAt); perr == nil {
			occurred = t.UTC()
		}
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return s.repo.UpsertInvestmentTransaction(ctx, domainfinance.InvestmentTransaction{
		ID: id.String(), UserID: in.UserID, PolpConsentID: in.PolpConsentID, PolpTxID: in.PolpTxID,
		PolpInvestID: in.PolpInvestID, Family: in.Family, Type: in.Type, Amount: amount,
		Currency: orDefault(in.Currency, "BRL"), OccurredAt: occurred, UpdatedAt: s.parseUpdatedAt(in.UpdatedAt),
	})
}

func (s *Service) UpsertOFRaw(ctx context.Context, in OFRawSyncedInput) error {
	if in.UserID == "" {
		return domainfinance.ErrUserIDRequired
	}
	if in.Resource == "" {
		return domainfinance.ErrRawResourceRequired
	}
	if in.ExternalID == "" {
		return domainfinance.ErrRawExternalIDRequired
	}
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	return s.repo.UpsertOFRaw(ctx, domainfinance.OFRaw{
		ID: id.String(), UserID: in.UserID, PolpConsentID: in.PolpConsentID,
		Resource: in.Resource, ExternalID: in.ExternalID, Payload: in.Payload, CapturedAt: s.now(),
	})
}

